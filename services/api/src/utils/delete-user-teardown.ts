import { and, eq, sql } from "drizzle-orm";
import { clearUserDeleted, markUserDeleted } from "@keeper.sh/calendar";
import { removeUserSyncJobs } from "@keeper.sh/queue";
import {
  calendarAccountsTable,
  calendarsTable,
  deletionResidueTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { widelog } from "@/utils/logging";
import {
  AbandonedPushChannelError,
  deregisterUserPushChannels,
} from "@/utils/push-notifications/deregister-account-channels";
import { RESIDUE_WRITE_FAILED_SLUG, SYNC_TEARDOWN_TIMEOUT_MS } from "@keeper.sh/auth";
import {
  OAUTH_GRANT_RESIDUE_KIND,
  PUSH_CHANNEL_RESIDUE_KIND,
  TEARDOWN_RESIDUE_KINDS,
} from "@keeper.sh/calendar";
import type { AbandonedPushChannelResidue } from "@/utils/push-notifications/deregister-account-channels";
import type {
  GoogleRevocationFetch,
  RedisTombstoneClient,
  TeardownResidueStore,
} from "@keeper.sh/calendar";
import type { DeleteUserTeardown } from "@keeper.sh/auth";
import type { database as databaseInstance } from "@/context";

const TEARDOWN_FAILED_SLUG = "delete-user-teardown-failed";
const STEP_ABORT_SETTLE_MS = 400;
const TOMBSTONE_TIMEOUT_MS = 500;
const SYNC_JOBS_TIMEOUT_MS = 1200;
const PUSH_CHANNELS_TIMEOUT_MS = 3000;
const OAUTH_GRANTS_TIMEOUT_MS = 1200;
const REVOCABLE_OAUTH_PROVIDER = "google";
const QUEUE_COMMAND_TIMEOUT_MS = 1000;
const QUEUE_MAX_RETRIES_PER_REQUEST = 3;

const TEARDOWN_BUDGET_MS = [
  TOMBSTONE_TIMEOUT_MS,
  SYNC_JOBS_TIMEOUT_MS,
  PUSH_CHANNELS_TIMEOUT_MS,
  OAUTH_GRANTS_TIMEOUT_MS,
].reduce((total, timeoutMs) => total + timeoutMs + STEP_ABORT_SETTLE_MS, 0);

if (TEARDOWN_BUDGET_MS >= SYNC_TEARDOWN_TIMEOUT_MS) {
  throw new Error(
    `Delete user teardown budget of ${TEARDOWN_BUDGET_MS}ms does not fit inside the ` +
      `${SYNC_TEARDOWN_TIMEOUT_MS}ms auth deadline supervising it`,
  );
}

interface DeleteUserSyncStep {
  name: string;
  run: (userId: string, signal: AbortSignal) => Promise<void>;
  timeoutMs: number;
}

type StepSettlement = { error: unknown; status: "rejected" } | { status: "fulfilled" };

interface DeleteUserSyncQueue {
  getJob: (jobId: string) => Promise<{ id?: string } | undefined>;
  remove: (jobId: string) => Promise<number>;
}

interface DeleteUserOAuthCredential {
  accessToken: string;
  accountId: string;
  email: string | null;
  provider: string;
  providerAccountId?: string | null;
  refreshToken: string | null;
  userId: string;
}

interface DeleteUserSyncTeardownDependencies {
  createQueue: () => DeleteUserSyncQueue;
  deregisterPushChannels: (userId: string, signal: AbortSignal) => Promise<number>;
  fetchImpl: GoogleRevocationFetch;
  listCalendarIds: (userId: string) => Promise<string[]>;
  listOAuthCredentials: (userId: string) => Promise<DeleteUserOAuthCredential[]>;
  redis: Pick<RedisTombstoneClient, "del" | "exists" | "set">;
  residue: TeardownResidueStore;
}

const throwIfAborted = (signal: AbortSignal, stepName: string): void => {
  if (!signal.aborted) {
    return;
  }

  if (signal.reason instanceof Error) {
    throw signal.reason;
  }

  throw new Error(`Teardown step ${stepName} was aborted: ${String(signal.reason)}`);
};

const reportStepFailure = (
  error: unknown,
  stepName: string,
  userId: string,
  slug: string,
): void => {
  const failure = {
    "delete_user.user_id": userId,
    prefix: `delete_user_teardown.${stepName}`,
    retriable: false,
    slug,
  };

  widelog.setFields({ "delete_user.user_id": userId });
  widelog.errorFields(error, failure);
};

const requireOwnCredentials = (
  credentials: DeleteUserOAuthCredential[],
  userId: string,
): DeleteUserOAuthCredential[] => {
  const foreign = credentials.filter((credential) => credential.userId !== userId);

  if (foreign.length > 0) {
    throw new Error(
      `Refusing to revoke oauth grants for user ${userId}: ${foreign.length} credential `
        + `rows carry another user id`,
    );
  }

  return credentials;
};

const recordOAuthGrantResidue = async (
  residue: TeardownResidueStore,
  userId: string,
  credential: DeleteUserOAuthCredential,
): Promise<boolean> => {
  try {
    await residue.record({
      credential: {
        accessToken: credential.accessToken,
        expiresAt: null,
        refreshToken: credential.refreshToken,
      },
      externalId: credential.accountId,
      kind: OAUTH_GRANT_RESIDUE_KIND,
      provider: credential.provider,
      userId,
      ...(credential.email !== null && { accountEmail: credential.email }),
      ...(typeof credential.providerAccountId === "string" && {
        providerAccountId: credential.providerAccountId,
      }),
    });

    return true;
  } catch (error) {
    reportStepFailure(error, "oauth_grants", userId, RESIDUE_WRITE_FAILED_SLUG);

    return false;
  }
};

const buildDeleteUserSyncSteps = (
  dependencies: DeleteUserSyncTeardownDependencies,
): DeleteUserSyncStep[] => [
  {
    name: "tombstone",
    run: (userId, signal) => markUserDeleted(dependencies.redis, userId, { signal }),
    timeoutMs: TOMBSTONE_TIMEOUT_MS,
  },
  {
    name: "sync_jobs",
    run: async (userId, signal) => {
      const calendarIds = await dependencies.listCalendarIds(userId);

      widelog.setFields({ "delete_user.calendar_count": calendarIds.length });

      if (calendarIds.length === 0) {
        return;
      }

      throwIfAborted(signal, "sync_jobs");

      const outcome = await removeUserSyncJobs(
        dependencies.createQueue(),
        userId,
        calendarIds,
      );

      widelog.setFields({
        "delete_user.sync_jobs_removed": outcome.removedJobIds.length,
        "delete_user.sync_jobs_unremovable": outcome.unremovableJobIds.length,
      });

      if (outcome.failures.length > 0) {
        const details = outcome.failures
          .map((failure) => `${failure.jobId}: ${failure.message}`)
          .join("; ");
        throw new Error(`Failed to remove queued sync jobs for user ${userId} — ${details}`);
      }
    },
    timeoutMs: SYNC_JOBS_TIMEOUT_MS,
  },
  {
    name: "push_channels",
    run: async (userId, signal) => {
      const deregistered = await dependencies.deregisterPushChannels(userId, signal);

      widelog.setFields({ "delete_user.push_channels_deregistered": deregistered });
    },
    timeoutMs: PUSH_CHANNELS_TIMEOUT_MS,
  },
  {
    name: "oauth_grants",
    run: async (userId, signal) => {
      const credentials = requireOwnCredentials(
        await dependencies.listOAuthCredentials(userId),
        userId,
      );
      const revocable = credentials.filter(
        (credential) => credential.provider === REVOCABLE_OAUTH_PROVIDER,
      );
      const notRevocable = credentials.filter(
        (credential) => credential.provider !== REVOCABLE_OAUTH_PROVIDER,
      );

      const recordings: boolean[] = [];

      for (const credential of revocable) {
        throwIfAborted(signal, "oauth_grants");

        recordings.push(await recordOAuthGrantResidue(dependencies.residue, userId, credential));
      }

      widelog.setFields({
        "delete_user.oauth_grants_not_revocable": notRevocable.map((credential) => ({
          accountId: credential.accountId,
          provider: credential.provider,
        })),
        "delete_user.oauth_grants_recorded": recordings.filter(Boolean).length,
      });
    },
    timeoutMs: OAUTH_GRANTS_TIMEOUT_MS,
  },
];

const settleWithin = async (
  settlement: Promise<StepSettlement>,
  ms: number,
): Promise<StepSettlement | null> => {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const expiry = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
    }, ms);
  });

  try {
    return await Promise.race([settlement, expiry]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
};

const runWithDeadline = async (
  name: string,
  deadlineMs: number,
  run: (signal: AbortSignal) => Promise<void>,
): Promise<void> => {
  const controller = new AbortController();
  const settlement: Promise<StepSettlement> = run(controller.signal).then(
    () => ({ status: "fulfilled" as const }),
    (error: unknown) => ({ error, status: "rejected" as const }),
  );

  const settled = await settleWithin(settlement, deadlineMs);

  if (settled !== null) {
    if (settled.status === "rejected") {
      throw settled.error;
    }
    return;
  }

  const deadlineMessage = `Teardown step ${name} exceeded its ${deadlineMs}ms deadline`;

  controller.abort(new Error(deadlineMessage));

  const afterAbort = await settleWithin(settlement, STEP_ABORT_SETTLE_MS);

  if (afterAbort !== null && afterAbort.status === "rejected") {
    throw new Error(deadlineMessage, { cause: afterAbort.error });
  }

  throw new Error(deadlineMessage);
};


const collectAbandonedChannels = (error: unknown): AbandonedPushChannelResidue[] => {
  if (error instanceof AbandonedPushChannelError) {
    return [error.residue];
  }

  if (error instanceof AggregateError) {
    return error.errors.flatMap((inner: unknown) => collectAbandonedChannels(inner));
  }

  if (error instanceof Error && "cause" in error) {
    return collectAbandonedChannels(error.cause);
  }

  return [];
};

const recordAbandonedChannels = async (
  residue: TeardownResidueStore,
  userId: string,
  stepName: string,
  error: unknown,
): Promise<void> => {
  for (const abandoned of collectAbandonedChannels(error)) {
    try {
      await residue.record({
        kind: PUSH_CHANNEL_RESIDUE_KIND,
        provider: abandoned.provider,
        providerChannelId: abandoned.providerChannelId,
        userId,
        ...(abandoned.credential !== null && { credential: abandoned.credential }),
        ...(abandoned.providerResourceId !== null && {
          providerResourceId: abandoned.providerResourceId,
        }),
      });
    } catch (residueError) {
      reportStepFailure(residueError, stepName, userId, RESIDUE_WRITE_FAILED_SLUG);
    }
  }
};

const createDeleteUserSyncTeardown =
  (dependencies: DeleteUserSyncTeardownDependencies): DeleteUserTeardown =>
  async (userId: string) => {
    for (const step of buildDeleteUserSyncSteps(dependencies)) {
      try {
        await runWithDeadline(step.name, step.timeoutMs, (signal) => step.run(userId, signal));
      } catch (error) {
        reportStepFailure(error, step.name, userId, TEARDOWN_FAILED_SLUG);

        await recordAbandonedChannels(dependencies.residue, userId, step.name, error);
      }
    }
  };

interface DeleteUserSyncTeardownRollbackDependencies
  extends Pick<DeleteUserSyncTeardownDependencies, "redis"> {
  residue: Pick<TeardownResidueStore, "deleteForUser">;
}

const discardRecordedResidue = async (
  dependencies: DeleteUserSyncTeardownRollbackDependencies,
  userId: string,
): Promise<void> => {
  const deleteForUser = dependencies.residue?.deleteForUser as
    | TeardownResidueStore["deleteForUser"]
    | undefined;

  if (typeof deleteForUser !== "function") {
    throw new TypeError(
      `Rollback for user ${userId} cannot discard its recorded residue: the residue store has no deleteForUser, so the residue was left behind`,
    );
  }

  const discardedPerKind = await Promise.all(
    TEARDOWN_RESIDUE_KINDS.map((kind) => deleteForUser(userId, kind)),
  );

  widelog.setFields({
    "delete_user.residue_discarded": discardedPerKind.reduce(
      (total, discarded) => total + discarded,
      0,
    ),
  });
};

const createDeleteUserSyncTeardownRollback =
  (dependencies: DeleteUserSyncTeardownRollbackDependencies): DeleteUserTeardown =>
  async (userId: string) => {
    await runWithDeadline("tombstone_rollback", TOMBSTONE_TIMEOUT_MS, async () => {
      await clearUserDeleted(dependencies.redis, userId);

      widelog.setFields({ "delete_user.tombstone_cleared": true });

      await discardRecordedResidue(dependencies, userId);
    });
  };

const TEARDOWN_QUEUE_CONNECTION_OPTIONS = {
  commandTimeout: QUEUE_COMMAND_TIMEOUT_MS,
  maxRetriesPerRequest: QUEUE_MAX_RETRIES_PER_REQUEST,
};

interface DeleteUserSyncTeardownContext {
  database: typeof databaseInstance;
  queue: DeleteUserSyncQueue;
  redis: Pick<RedisTombstoneClient, "del" | "exists" | "set">;
  residue: TeardownResidueStore;
}

const createApiDeleteUserSyncTeardown = (
  context: DeleteUserSyncTeardownContext,
): DeleteUserTeardown =>
  createDeleteUserSyncTeardown({
    createQueue: () => context.queue,
    deregisterPushChannels: deregisterUserPushChannels,
    fetchImpl: fetch,
    listCalendarIds: async (userId) => {
      const rows = await context.database
        .select({ id: calendarsTable.id })
        .from(calendarsTable)
        .where(eq(calendarsTable.userId, userId));
      return rows.map((row) => row.id);
    },
    listOAuthCredentials: (userId) =>
      context.database
        .select({
          accessToken: oauthCredentialsTable.accessToken,
          accountId: oauthCredentialsTable.id,
          email: oauthCredentialsTable.email,
          provider: oauthCredentialsTable.provider,
          providerAccountId: sql<string | null>`max(${calendarAccountsTable.accountId})`,
          refreshToken: oauthCredentialsTable.refreshToken,
          userId: oauthCredentialsTable.userId,
        })
        .from(oauthCredentialsTable)
        .leftJoin(
          calendarAccountsTable,
          and(
            eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
            eq(calendarAccountsTable.provider, oauthCredentialsTable.provider),
          ),
        )
        .where(eq(oauthCredentialsTable.userId, userId))
        .groupBy(oauthCredentialsTable.id),
    redis: context.redis,
    residue: {
      ...context.residue,
      list: async () => {
        const rows = await context.database
          .select({
            id: deletionResidueTable.id,
            kind: deletionResidueTable.kind,
            provider: deletionResidueTable.provider,
            userId: deletionResidueTable.userId,
          })
          .from(deletionResidueTable)
          .where(eq(deletionResidueTable.kind, PUSH_CHANNEL_RESIDUE_KIND));

        return rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          userId: row.userId,
          ...(row.provider !== null && { provider: row.provider }),
        }));
      },
    },
  });

export {
  createApiDeleteUserSyncTeardown,
  createDeleteUserSyncTeardown,
  createDeleteUserSyncTeardownRollback,
  OAUTH_GRANTS_TIMEOUT_MS,
  PUSH_CHANNELS_TIMEOUT_MS,
  STEP_ABORT_SETTLE_MS,
  TEARDOWN_BUDGET_MS,
  TEARDOWN_FAILED_SLUG,
  TEARDOWN_QUEUE_CONNECTION_OPTIONS,
};
export type {
  DeleteUserOAuthCredential,
  DeleteUserSyncQueue,
  DeleteUserSyncTeardownRollbackDependencies,
  DeleteUserSyncTeardownContext,
  DeleteUserSyncTeardownDependencies,
};
