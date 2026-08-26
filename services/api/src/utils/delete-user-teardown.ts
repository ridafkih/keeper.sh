import { eq } from "drizzle-orm";
import { clearUserDeleted, markUserDeleted } from "@keeper.sh/calendar";
import { createPushSyncQueue, removeUserSyncJobs } from "@keeper.sh/queue";
import { calendarsTable } from "@keeper.sh/database/schema";
import { widelog } from "@/utils/logging";
import { deregisterUserPushChannels } from "@/utils/push-notifications/deregister-account-channels";
import { SYNC_TEARDOWN_TIMEOUT_MS } from "@keeper.sh/auth";
import type { RedisTombstoneClient } from "@keeper.sh/calendar";
import type { DeleteUserTeardown } from "@keeper.sh/auth";

const TEARDOWN_FAILED_SLUG = "delete-user-teardown-failed";
const STEP_ABORT_SETTLE_MS = 400;
const TOMBSTONE_TIMEOUT_MS = 500;
const SYNC_JOBS_TIMEOUT_MS = 1200;
const PUSH_CHANNELS_TIMEOUT_MS = 3800;
const QUEUE_COMMAND_TIMEOUT_MS = 1000;
const QUEUE_MAX_RETRIES_PER_REQUEST = 3;

const STEP_TIMEOUTS_MS = [
  TOMBSTONE_TIMEOUT_MS,
  SYNC_JOBS_TIMEOUT_MS,
  PUSH_CHANNELS_TIMEOUT_MS,
];

const TEARDOWN_BUDGET_MS = STEP_TIMEOUTS_MS.reduce(
  (total, timeoutMs) => total + timeoutMs + STEP_ABORT_SETTLE_MS,
  0,
);

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

interface DeleteUserSyncTeardownDependencies {
  createQueue: () => DeleteUserSyncQueue;
  deregisterPushChannels: (userId: string, signal: AbortSignal) => Promise<number>;
  listCalendarIds: (userId: string) => Promise<string[]>;
  redis: Pick<RedisTombstoneClient, "del" | "exists" | "set">;
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

  const deadlineError = new Error(
    `Teardown step ${name} exceeded its ${deadlineMs}ms deadline`,
  );

  controller.abort(deadlineError);

  await settleWithin(settlement, STEP_ABORT_SETTLE_MS);

  throw deadlineError;
};

const createDeleteUserSyncTeardown =
  (dependencies: DeleteUserSyncTeardownDependencies): DeleteUserTeardown =>
  async (userId: string) => {
    for (const step of buildDeleteUserSyncSteps(dependencies)) {
      try {
        await runWithDeadline(step.name, step.timeoutMs, (signal) => step.run(userId, signal));
      } catch (error) {
        widelog.errorFields(error, {
          prefix: `delete_user_teardown.${step.name}`,
          retriable: false,
          slug: TEARDOWN_FAILED_SLUG,
        });
      }
    }
  };

const createDeleteUserSyncTeardownRollback =
  (dependencies: Pick<DeleteUserSyncTeardownDependencies, "redis">): DeleteUserTeardown =>
  async (userId: string) => {
    await runWithDeadline("tombstone_rollback", TOMBSTONE_TIMEOUT_MS, async () => {
      await clearUserDeleted(dependencies.redis, userId);

      widelog.setFields({ "delete_user.tombstone_cleared": true });
    });
  };

let pushSyncQueue: DeleteUserSyncQueue | null = null;

const resolvePushSyncQueue = (redisUrl: string): DeleteUserSyncQueue => {
  pushSyncQueue ??= createPushSyncQueue({
    url: redisUrl,
    commandTimeout: QUEUE_COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: QUEUE_MAX_RETRIES_PER_REQUEST,
  });
  return pushSyncQueue;
};

const deleteUserSyncTeardownRollback: DeleteUserTeardown = async (userId) => {
  const { redis } = await import("@/context");

  await createDeleteUserSyncTeardownRollback({ redis })(userId);
};

const deleteUserSyncTeardown: DeleteUserTeardown = async (userId) => {
  const { database, env, redis } = await import("@/context");

  await createDeleteUserSyncTeardown({
    createQueue: () => resolvePushSyncQueue(env.REDIS_URL),
    deregisterPushChannels: deregisterUserPushChannels,
    listCalendarIds: async (scopeUserId) => {
      const rows = await database
        .select({ id: calendarsTable.id })
        .from(calendarsTable)
        .where(eq(calendarsTable.userId, scopeUserId));
      return rows.map((row) => row.id);
    },
    redis,
  })(userId);
};

export {
  createDeleteUserSyncTeardown,
  createDeleteUserSyncTeardownRollback,
  deleteUserSyncTeardown,
  deleteUserSyncTeardownRollback,
  PUSH_CHANNELS_TIMEOUT_MS,
  STEP_ABORT_SETTLE_MS,
  TEARDOWN_BUDGET_MS,
  TEARDOWN_FAILED_SLUG,
};
export type { DeleteUserSyncQueue, DeleteUserSyncTeardownDependencies };
