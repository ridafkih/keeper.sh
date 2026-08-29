import { and, eq, isNotNull } from "drizzle-orm";
import { clearUserDeleted, confirmUserDeletion, markUserDeleted, markUserDeletionUnconfirmed } from "@keeper.sh/calendar";
import { removeUserSyncJobs } from "@keeper.sh/queue";
import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { widelog } from "@/utils/logging";
import {
  AbandonedPushChannelError,
  deregisterUserPushChannels,
  listUserTeardownPushChannels,
} from "@/utils/push-notifications/deregister-account-channels";
import {
  RESIDUE_WRITE_FAILED_SLUG,
  SYNC_TEARDOWN_TIMEOUT_MS,
  TEARDOWN_BLOCKED_ERROR_NAME,
} from "@keeper.sh/auth";
import {
  PUSH_CHANNEL_RESIDUE_KIND,
  TEARDOWN_RESIDUE_KINDS,
} from "@keeper.sh/calendar";
import type {
  AbandonedPushChannelResidue,
  TeardownPushChannel,
} from "@/utils/push-notifications/deregister-account-channels";
import type {
  RedisTombstoneClient,
  TeardownResidueStore,
} from "@keeper.sh/calendar";
import type { DeleteUserTeardown } from "@keeper.sh/auth";
import {
  PUSH_CHANNELS_TIMEOUT_MS,
  STEP_ABORT_SETTLE_MS,
} from "@/utils/teardown-step-budgets";
import type { database as databaseInstance } from "@/context";

const TEARDOWN_FAILED_SLUG = "delete-user-teardown-failed";
const TOMBSTONE_TIMEOUT_MS = 500;
const RESIDUE_DISCARD_TIMEOUT_MS = 500;
const LATE_RESIDUE_SETTLE_TIMEOUT_MS = 5000;
const RESIDUE_DISCARD_STEP_TIMEOUT_MS = LATE_RESIDUE_SETTLE_TIMEOUT_MS + RESIDUE_DISCARD_TIMEOUT_MS;
const TOMBSTONE_ROLLBACK_STEP = "tombstone_rollback";
const RESIDUE_DISCARD_ROLLBACK_STEP = "residue_discard_rollback";
const SYNC_JOBS_TIMEOUT_MS = 1000;
const RESIDUE_WRITE_RESERVE_MS = 800;
const TEARDOWN_HEADROOM_MS = 1000;
const PUSH_CHANNELS_STEP = "push_channels";
const GRANT_CENSUS_STEP = "oauth_grant_census";
const GRANT_CENSUS_TIMEOUT_MS = 500;
const QUEUE_COMMAND_TIMEOUT_MS = 1000;
const QUEUE_MAX_RETRIES_PER_REQUEST = 3;

const TEARDOWN_STEPS_BUDGET_MS = [
  TOMBSTONE_TIMEOUT_MS,
  SYNC_JOBS_TIMEOUT_MS,
  GRANT_CENSUS_TIMEOUT_MS,
  PUSH_CHANNELS_TIMEOUT_MS,
].reduce((total, timeoutMs) => total + timeoutMs + STEP_ABORT_SETTLE_MS, 0);

const TEARDOWN_BUDGET_MS = TEARDOWN_STEPS_BUDGET_MS + RESIDUE_WRITE_RESERVE_MS;

if (TEARDOWN_BUDGET_MS + TEARDOWN_HEADROOM_MS > SYNC_TEARDOWN_TIMEOUT_MS) {
  throw new Error(
    `Delete user teardown budget of ${TEARDOWN_STEPS_BUDGET_MS}ms of steps plus ` +
      `${RESIDUE_WRITE_RESERVE_MS}ms reserved for residue writes does not leave the ` +
      `${TEARDOWN_HEADROOM_MS}ms of scheduling headroom required inside the ` +
      `${SYNC_TEARDOWN_TIMEOUT_MS}ms auth deadline supervising it`,
  );
}

const ROLLBACK_BUDGET_MS =
  Math.max(TOMBSTONE_TIMEOUT_MS, RESIDUE_DISCARD_STEP_TIMEOUT_MS) + STEP_ABORT_SETTLE_MS;

if (ROLLBACK_BUDGET_MS >= SYNC_TEARDOWN_TIMEOUT_MS) {
  throw new Error(
    `Delete user rollback budget of ${ROLLBACK_BUDGET_MS}ms does not fit inside the ` +
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

interface UserPushChannelDeregistration {
  stoppedProviderChannelIds: string[];
}

interface DeleteUserSyncTeardownDependencies {
  createQueue: () => DeleteUserSyncQueue;
  deregisterPushChannels: (
    userId: string,
    signal: AbortSignal,
  ) => Promise<UserPushChannelDeregistration>;
  listCalendarIds: (userId: string) => Promise<string[]>;
  listOAuthGrantProviders: (userId: string) => Promise<{ provider: string }[]>;
  listPushChannels: (userId: string) => Promise<TeardownPushChannel[]>;
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

interface PushChannelCapture {
  capturedChannelIds: string[];
  dialable: number;
}

class TeardownBlockedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = TEARDOWN_BLOCKED_ERROR_NAME;
  }
}

const LATE_RESIDUE_WRITES: unique symbol = Symbol.for(
  "keeper.sh/delete-user-teardown/late-residue-writes",
);

type LateResidueWriteRegistry = Map<string, Promise<void>[]>;

interface LateResidueWriteHolder {
  [LATE_RESIDUE_WRITES]?: LateResidueWriteRegistry;
}

const lateResidueWritesOf = (residue: object): LateResidueWriteRegistry => {
  const holder = residue as LateResidueWriteHolder;
  const registry: LateResidueWriteRegistry = holder[LATE_RESIDUE_WRITES] ?? new Map();

  holder[LATE_RESIDUE_WRITES] = registry;

  return registry;
};

const registerLateResidueWrite = (
  residue: object,
  userId: string,
  write: Promise<void>,
): Promise<void> => {
  const registry = lateResidueWritesOf(residue);
  const tracked: Promise<void> = write.finally(() => {
    const remaining = (registry.get(userId) ?? []).filter((entry) => entry !== tracked);

    if (remaining.length === 0) {
      registry.delete(userId);
      return;
    }

    registry.set(userId, remaining);
  });

  registry.set(userId, [...(registry.get(userId) ?? []), tracked]);

  return tracked;
};

const requireOwnPushChannels = (
  channels: TeardownPushChannel[],
  userId: string,
): TeardownPushChannel[] => {
  const foreign = channels.filter((channel) => channel.userId !== userId);

  if (foreign.length > 0) {
    throw new Error(
      `Refusing to record push channel residue for user ${userId}: ${foreign.length} channel `
        + `rows carry another user id`,
    );
  }

  return channels;
};

const recordPushChannelResidue = async (
  residue: TeardownResidueStore,
  userId: string,
  channel: TeardownPushChannel,
  providerChannelId: string,
): Promise<boolean> => {
  try {
    await registerLateResidueWrite(
      residue,
      userId,
      residue.record({
        kind: PUSH_CHANNEL_RESIDUE_KIND,
        provider: channel.provider,
        providerChannelId,
        userId,
        ...(channel.credential !== null && { credential: channel.credential }),
        ...(channel.providerResourceId !== null && {
          providerResourceId: channel.providerResourceId,
        }),
      }),
    );

    return true;
  } catch (error) {
    reportStepFailure(error, PUSH_CHANNELS_STEP, userId, RESIDUE_WRITE_FAILED_SLUG);

    return false;
  }
};

const retainedOAuthGrantProviders = async (
  dependencies: DeleteUserSyncTeardownDependencies,
  userId: string,
): Promise<string[]> => {
  const grants = await dependencies.listOAuthGrantProviders(userId);
  const providers = grants.map((grant) => grant.provider);
  const invalid = providers.filter(
    (provider) => typeof provider !== "string" || provider.length === 0,
  );

  if (invalid.length > 0) {
    throw new Error(
      `Refusing to report retained oauth grants for user ${userId}: ${invalid.length} provider `
        + `account rows carry no provider name`,
    );
  }

  return [...new Set(providers)].toSorted();
};

const RETAINED_GRANTS_UNAVAILABLE = "unavailable";

const censusedOAuthGrantProviders = async (
  dependencies: DeleteUserSyncTeardownDependencies,
  userId: string,
): Promise<string[] | typeof RETAINED_GRANTS_UNAVAILABLE> => {
  try {
    return await retainedOAuthGrantProviders(dependencies, userId);
  } catch (error) {
    reportStepFailure(error, GRANT_CENSUS_STEP, userId, TEARDOWN_FAILED_SLUG);

    return RETAINED_GRANTS_UNAVAILABLE;
  }
};

const censusUnlessAborted = async (
  dependencies: DeleteUserSyncTeardownDependencies,
  userId: string,
  signal: AbortSignal,
): Promise<string[] | typeof RETAINED_GRANTS_UNAVAILABLE> => {
  if (signal.aborted) {
    return RETAINED_GRANTS_UNAVAILABLE;
  }

  const listenerScope = new AbortController();

  try {
    return await Promise.race([
      censusedOAuthGrantProviders(dependencies, userId),
      new Promise<typeof RETAINED_GRANTS_UNAVAILABLE>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            resolve(RETAINED_GRANTS_UNAVAILABLE);
          },
          { once: true, signal: listenerScope.signal },
        );
      }),
    ]);
  } finally {
    listenerScope.abort();
  }
};

const dialableTeardownChannels = (
  channels: TeardownPushChannel[],
): { channel: TeardownPushChannel; providerChannelId: string }[] =>
  channels.flatMap((channel) => {
    const { providerChannelId } = channel;

    if (typeof providerChannelId !== "string" || providerChannelId.length === 0) {
      return [];
    }

    return [{ channel, providerChannelId }];
  });

const incompleteCaptureBlocked = (
  userId: string,
  captured: number,
  dialable: number,
): TeardownBlockedError =>
  new TeardownBlockedError(
    `Teardown step ${PUSH_CHANNELS_STEP} for user ${userId} captured ${captured} of ${dialable} `
      + `live push channels, so the delete is blocked rather than cascading the uncaptured `
      + `channels away`,
  );

const raceStepAbort = async <Value>(
  work: Promise<Value>,
  signal: AbortSignal,
  blocked: () => TeardownBlockedError,
): Promise<Value> => {
  const listenerScope = new AbortController();

  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            reject(blocked());
          },
          { once: true, signal: listenerScope.signal },
        );
      }),
    ]);
  } finally {
    listenerScope.abort();
  }
};

const captureLivePushChannels = async (
  residue: TeardownResidueStore,
  userId: string,
  channels: TeardownPushChannel[],
  signal: AbortSignal,
): Promise<PushChannelCapture> => {
  const dialable = dialableTeardownChannels(channels);
  const blockedAt = (capturedCount: number): TeardownBlockedError =>
    incompleteCaptureBlocked(userId, capturedCount, dialable.length);

  if (signal.aborted) {
    throw blockedAt(0);
  }

  const settledCaptures: string[] = [];

  const outcomes = await raceStepAbort(
    Promise.all(
      dialable.map(async ({ channel, providerChannelId }) => {
        const recorded = await recordPushChannelResidue(
          residue,
          userId,
          channel,
          providerChannelId,
        );

        if (recorded) {
          settledCaptures.push(providerChannelId);
        }

        return { providerChannelId, recorded };
      }),
    ),
    signal,
    () => blockedAt(settledCaptures.length),
  );

  const capturedChannelIds = outcomes
    .filter(({ recorded }) => recorded)
    .map(({ providerChannelId }) => providerChannelId);

  if (signal.aborted) {
    throw blockedAt(capturedChannelIds.length);
  }

  return { capturedChannelIds, dialable: dialable.length };
};

const readLivePushChannels = async (
  dependencies: DeleteUserSyncTeardownDependencies,
  userId: string,
  signal: AbortSignal,
): Promise<PushChannelCapture> => {
  try {
    const listed = await raceStepAbort(
      dependencies.listPushChannels(userId),
      signal,
      () =>
        new TeardownBlockedError(
          `Teardown step ${PUSH_CHANNELS_STEP} for user ${userId} could not read the live push `
            + `channels it must capture within its step deadline, so the delete is blocked rather `
            + `than cascading them away`,
        ),
    );

    return await captureLivePushChannels(
      dependencies.residue,
      userId,
      requireOwnPushChannels(listed, userId),
      signal,
    );
  } catch (error) {
    if (error instanceof TeardownBlockedError) {
      throw error;
    }

    reportStepFailure(error, PUSH_CHANNELS_STEP, userId, RESIDUE_WRITE_FAILED_SLUG);

    throw new TeardownBlockedError(
      `Teardown step ${PUSH_CHANNELS_STEP} for user ${userId} could not read the live push `
        + `channels it must capture, so the delete is blocked rather than cascading them away`,
      { cause: error },
    );
  }
};

const capturePushChannelResidue = async (
  dependencies: DeleteUserSyncTeardownDependencies,
  userId: string,
  signal: AbortSignal,
): Promise<PushChannelCapture> => {
  const capture = await readLivePushChannels(dependencies, userId, signal);

  if (capture.capturedChannelIds.length < capture.dialable) {
    throw incompleteCaptureBlocked(
      userId,
      capture.capturedChannelIds.length,
      capture.dialable,
    );
  }

  return capture;
};

interface PushChannelDeregistration {
  abandonedChannelIds: string[];
  failure: { error: unknown } | null;
  stoppedProviderChannelIds: string[] | null;
}

const attributedAbandonments = (
  error: unknown,
): AbandonedPushChannelResidue[] | null => {
  if (error instanceof AbandonedPushChannelError) {
    return [error.residue];
  }

  if (error instanceof AggregateError) {
    const nested = error.errors.map((inner: unknown) => attributedAbandonments(inner));

    if (nested.some((entry) => entry === null)) {
      return null;
    }

    return nested.flatMap((entry) => entry ?? []);
  }

  return null;
};

const deregisterLivePushChannels = async (
  dependencies: DeleteUserSyncTeardownDependencies,
  userId: string,
  signal: AbortSignal,
): Promise<PushChannelDeregistration> => {
  try {
    const { stoppedProviderChannelIds } = await dependencies.deregisterPushChannels(
      userId,
      signal,
    );

    return {
      abandonedChannelIds: [],
      failure: null,
      stoppedProviderChannelIds,
    };
  } catch (error) {
    const abandoned = attributedAbandonments(error);

    if (abandoned === null) {
      throw error;
    }

    return {
      abandonedChannelIds: abandoned.map((residue) => residue.providerChannelId),
      failure: { error },
      stoppedProviderChannelIds: null,
    };
  }
};

const clearListedPushChannelResidue = async (
  residue: TeardownResidueStore,
  userId: string,
  stoppedChannelIds: string[],
): Promise<number> => {
  const stopped = new Set(stoppedChannelIds);
  const listed = await residue.list();
  const doomed = listed.filter(
    (row) =>
      row.userId === userId
      && row.kind === PUSH_CHANNEL_RESIDUE_KIND
      && typeof row.providerChannelId === "string"
      && stopped.has(row.providerChannelId),
  );

  for (const row of doomed) {
    await residue.clear(row.id);
  }

  return doomed.length;
};

const clearStoppedPushChannelResidue = async (
  residue: TeardownResidueStore,
  userId: string,
  stoppedChannelIds: string[],
): Promise<number> => {
  if (stoppedChannelIds.length === 0) {
    return 0;
  }

  const deleteResidue = residue.delete;

  if (typeof deleteResidue !== "function") {
    return await clearListedPushChannelResidue(residue, userId, stoppedChannelIds);
  }

  const cleared: number[] = [];

  for (const providerChannelId of stoppedChannelIds) {
    cleared.push(await deleteResidue(userId, PUSH_CHANNEL_RESIDUE_KIND, providerChannelId));
  }

  return cleared.reduce((total, count) => total + count, 0);
};

const buildDeleteUserSyncSteps = (
  dependencies: DeleteUserSyncTeardownDependencies,
): DeleteUserSyncStep[] => [
  {
    name: "tombstone",
    run: async (userId, signal) => {
      await markUserDeletionUnconfirmed(dependencies.redis, userId, { signal });
      await markUserDeleted(dependencies.redis, userId, { signal });
    },
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
    name: GRANT_CENSUS_STEP,
    run: async (userId, signal) => {
      widelog.setFields({
        "delete_user.oauth_grants_retained": await censusUnlessAborted(
          dependencies,
          userId,
          signal,
        ),
      });
    },
    timeoutMs: GRANT_CENSUS_TIMEOUT_MS,
  },
  {
    name: PUSH_CHANNELS_STEP,
    run: async (userId, signal) => {
      const capture = await capturePushChannelResidue(dependencies, userId, signal);

      widelog.setFields({
        "delete_user.push_channels_captured": capture.capturedChannelIds.length,
      });

      throwIfAborted(signal, PUSH_CHANNELS_STEP);

      const outcome = await deregisterLivePushChannels(dependencies, userId, signal);
      const abandoned = new Set(outcome.abandonedChannelIds);
      const stoppedChannelIds = outcome.stoppedProviderChannelIds
        ?? capture.capturedChannelIds.filter(
          (providerChannelId) => !abandoned.has(providerChannelId),
        );
      const stopped = new Set(stoppedChannelIds);
      const unaccounted = capture.capturedChannelIds.filter(
        (providerChannelId) =>
          !abandoned.has(providerChannelId) && !stopped.has(providerChannelId),
      );

      widelog.setFields({
        "delete_user.push_channels_abandoned": outcome.abandonedChannelIds.length,
        "delete_user.push_channels_deregistered": stoppedChannelIds.length,
        "delete_user.push_channels_unaccounted": unaccounted.length,
      });

      const cleared = await clearStoppedPushChannelResidue(
        dependencies.residue,
        userId,
        stoppedChannelIds,
      );

      widelog.setFields({ "delete_user.push_channels_residue_cleared": cleared });

      if (outcome.failure !== null) {
        throw outcome.failure.error;
      }
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

class DeadlineExceededError extends Error {
  readonly settlement: Promise<StepSettlement>;

  constructor(message: string, settlement: Promise<StepSettlement>) {
    super(message);
    this.name = "DeadlineExceededError";
    this.settlement = settlement;
  }
}

const deadlineFailure = (deadlineMessage: string, cause: unknown): Error => {
  if (cause instanceof TeardownBlockedError) {
    return new TeardownBlockedError(`${deadlineMessage}: ${cause.message}`, { cause });
  }

  return new Error(deadlineMessage, { cause });
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
    throw deadlineFailure(deadlineMessage, afterAbort.error);
  }

  throw new DeadlineExceededError(deadlineMessage, settlement);
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

const recordChannelsAbandonedAfterTheAbortWindow = async (
  residue: TeardownResidueStore,
  userId: string,
  stepName: string,
  settlement: Promise<StepSettlement>,
): Promise<void> => {
  try {
    const outcome = await settlement;

    if (outcome.status !== "rejected") {
      return;
    }

    await recordAbandonedChannels(residue, userId, stepName, outcome.error);
  } catch (error) {
    reportStepFailure(error, stepName, userId, RESIDUE_WRITE_FAILED_SLUG);
  }
};

const takeLateResidueWrites = (residue: object, userId: string): Promise<void>[] => {
  const registry = lateResidueWritesOf(residue);
  const pending = registry.get(userId) ?? [];

  registry.delete(userId);

  return pending;
};

const settleLateResidueWrites = async (
  pending: Promise<void>[],
  timeoutMs: number,
): Promise<boolean> => {
  if (pending.length === 0) {
    return true;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;

  const expiry = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
  });

  try {
    return await Promise.race([Promise.allSettled(pending).then(() => true), expiry]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
};

const trackLateResidueWrite = (
  dependencies: DeleteUserSyncTeardownDependencies,
  userId: string,
  stepName: string,
  write: Promise<void>,
): Promise<void> => {
  const store: unknown = dependencies.residue;

  if (typeof store !== "object" || store === null) {
    reportStepFailure(
      new TypeError(
        `Teardown step ${stepName} for user ${userId} cannot track its in-flight residue write: no residue store was injected, so a rollback cannot wait for it`,
      ),
      stepName,
      userId,
      RESIDUE_WRITE_FAILED_SLUG,
    );

    return write;
  }

  return registerLateResidueWrite(store, userId, write);
};

const remainingLateResidueDrainMs = (
  steps: DeleteUserSyncStep[],
  index: number,
  teardownDeadlineAt: number,
): number => {
  const reservedMs = steps
    .slice(index + 1)
    .reduce((total, step) => total + step.timeoutMs + STEP_ABORT_SETTLE_MS, 0);

  return Math.max(0, teardownDeadlineAt - Date.now() - reservedMs);
};

const createDeleteUserSyncTeardown =
  (dependencies: DeleteUserSyncTeardownDependencies): DeleteUserTeardown =>
  async (userId: string) => {
    const steps = buildDeleteUserSyncSteps(dependencies);
    const teardownDeadlineAt = Date.now() + TEARDOWN_BUDGET_MS;

    let lateResidueWriteCount = 0;

    for (const [index, step] of steps.entries()) {
      const lateResidueWrites: Promise<void>[] = [];

      try {
        await runWithDeadline(step.name, step.timeoutMs, (signal) => step.run(userId, signal));
      } catch (error) {
        reportStepFailure(error, step.name, userId, TEARDOWN_FAILED_SLUG);

        if (error instanceof TeardownBlockedError) {
          throw error;
        }

        lateResidueWrites.push(
          trackLateResidueWrite(
            dependencies,
            userId,
            step.name,
            recordAbandonedChannels(dependencies.residue, userId, step.name, error),
          ),
        );

        if (error instanceof DeadlineExceededError) {
          lateResidueWrites.push(
            trackLateResidueWrite(
              dependencies,
              userId,
              step.name,
              recordChannelsAbandonedAfterTheAbortWindow(
                dependencies.residue,
                userId,
                step.name,
                error.settlement,
              ),
            ),
          );
        }
      }

      const settled = await settleLateResidueWrites(
        lateResidueWrites,
        remainingLateResidueDrainMs(steps, index, teardownDeadlineAt),
      );

      if (!settled) {
        reportStepFailure(
          new Error(
            `Teardown step ${step.name} for user ${userId} ran out of budget waiting for `
              + `${lateResidueWrites.length} in-flight residue write(s), so the grant residue `
              + `may become durable before the push residue`,
          ),
          step.name,
          userId,
          RESIDUE_WRITE_FAILED_SLUG,
        );
      }

      lateResidueWriteCount += lateResidueWrites.length;
    }

    widelog.setFields({ "delete_user.late_residue_writes": lateResidueWriteCount });
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

  const pending = takeLateResidueWrites(dependencies.residue, userId);
  const settled = await settleLateResidueWrites(pending, LATE_RESIDUE_SETTLE_TIMEOUT_MS);

  widelog.setFields({
    "delete_user.late_residue_writes_awaited": pending.length,
    "delete_user.late_residue_writes_settled": settled,
  });

  const discardedPerKind = await Promise.all(
    TEARDOWN_RESIDUE_KINDS.map((kind) => deleteForUser(userId, kind)),
  );

  widelog.setFields({
    "delete_user.residue_discarded": discardedPerKind.reduce(
      (total, discarded) => total + discarded,
      0,
    ),
  });

  if (!settled) {
    throw new Error(
      `Rollback for user ${userId} waited ${LATE_RESIDUE_SETTLE_TIMEOUT_MS}ms for ${pending.length} in-flight residue write(s) that never settled, so residue recorded after the discard is left behind`,
    );
  }
};

const describeRollbackFailure = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const createDeleteUserSyncTeardownRollback =
  (dependencies: DeleteUserSyncTeardownRollbackDependencies): DeleteUserTeardown =>
  async (userId: string) => {
    const steps = [
      {
        name: TOMBSTONE_ROLLBACK_STEP,
        run: async (): Promise<void> => {
          await clearUserDeleted(dependencies.redis, userId);

          widelog.setFields({ "delete_user.tombstone_cleared": true });
        },
        timeoutMs: TOMBSTONE_TIMEOUT_MS,
      },
      {
        name: RESIDUE_DISCARD_ROLLBACK_STEP,
        run: (): Promise<void> => discardRecordedResidue(dependencies, userId),
        timeoutMs: RESIDUE_DISCARD_STEP_TIMEOUT_MS,
      },
    ];

    const settlements = await Promise.all(
      steps.map(async (step) => {
        try {
          await runWithDeadline(step.name, step.timeoutMs, () => step.run());

          return [];
        } catch (error) {
          return [{ error, name: step.name }];
        }
      }),
    );

    const failures = settlements.flat();

    widelog.setFields({
      "delete_user.residue_left_behind": failures.some(
        (failure) => failure.name === RESIDUE_DISCARD_ROLLBACK_STEP,
      ),
    });

    if (failures.length === 0) {
      return;
    }

    for (const failure of failures) {
      reportStepFailure(failure.error, failure.name, userId, TEARDOWN_FAILED_SLUG);
    }

    throw new AggregateError(
      failures.map((failure) => failure.error),
      `Delete user rollback for user ${userId} failed: ${failures
        .map((failure) => `${failure.name}: ${describeRollbackFailure(failure.error)}`)
        .join("; ")}`,
    );
  };

const createDeleteUserTombstoneProvisionalMarker =
  (dependencies: Pick<DeleteUserSyncTeardownDependencies, "redis">): DeleteUserTeardown =>
  async (userId: string) => {
    await markUserDeletionUnconfirmed(dependencies.redis, userId, {
      signal: AbortSignal.timeout(TOMBSTONE_TIMEOUT_MS),
    });

    widelog.setFields({ "delete_user.tombstone_marked_provisional": true });
  };

const createDeleteUserTombstoneConfirmer =
  (dependencies: Pick<DeleteUserSyncTeardownDependencies, "redis">): DeleteUserTeardown =>
  async (userId: string) => {
    await confirmUserDeletion(dependencies.redis, userId);

    widelog.setFields({ "delete_user.tombstone_confirmed": true });
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
    listCalendarIds: async (userId) => {
      const rows = await context.database
        .select({ id: calendarsTable.id })
        .from(calendarsTable)
        .where(eq(calendarsTable.userId, userId));
      return rows.map((row) => row.id);
    },
    listOAuthGrantProviders: async (userId) =>
      await context.database
        .selectDistinct({ provider: calendarAccountsTable.provider })
        .from(calendarAccountsTable)
        .where(and(
          eq(calendarAccountsTable.userId, userId),
          isNotNull(calendarAccountsTable.oauthCredentialId),
        )),
    listPushChannels: listUserTeardownPushChannels,
    redis: context.redis,
    residue: context.residue,
  });

export {
  createApiDeleteUserSyncTeardown,
  createDeleteUserSyncTeardown,
  createDeleteUserSyncTeardownRollback,
  createDeleteUserTombstoneConfirmer,
  createDeleteUserTombstoneProvisionalMarker,
  PUSH_CHANNELS_TIMEOUT_MS,
  STEP_ABORT_SETTLE_MS,
  TEARDOWN_BUDGET_MS,
  TEARDOWN_FAILED_SLUG,
  TEARDOWN_QUEUE_CONNECTION_OPTIONS,
  TeardownBlockedError,
};
export type {
  DeleteUserSyncQueue,
  DeleteUserSyncTeardownRollbackDependencies,
  DeleteUserSyncTeardownContext,
  DeleteUserSyncTeardownDependencies,
};
