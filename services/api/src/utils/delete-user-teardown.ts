import { eq } from "drizzle-orm";
import { clearUserDeleted, markUserDeleted } from "@keeper.sh/calendar";
import { createPushSyncQueue, removeUserSyncJobs } from "@keeper.sh/queue";
import { calendarsTable } from "@keeper.sh/database/schema";
import { widelog } from "@/utils/logging";
import { deregisterUserPushChannels } from "@/utils/push-notifications/deregister-account-channels";
import type { RedisTombstoneClient } from "@keeper.sh/calendar";
import type { DeleteUserTeardown, DeleteUserTeardownStep } from "@keeper.sh/auth";

const TEARDOWN_FAILED_SLUG = "delete-user-teardown-failed";
const TEARDOWN_BUDGET_MS = 7500;
const TOMBSTONE_TIMEOUT_MS = 1000;
const SYNC_JOBS_TIMEOUT_MS = 2000;
const PUSH_CHANNELS_TIMEOUT_MS = 5500;
const QUEUE_COMMAND_TIMEOUT_MS = 5000;
const QUEUE_MAX_RETRIES_PER_REQUEST = 3;

interface DeleteUserSyncQueue {
  getJob: (jobId: string) => Promise<{ id?: string } | undefined>;
  remove: (jobId: string) => Promise<number>;
}

interface DeleteUserSyncTeardownDependencies {
  createQueue: () => DeleteUserSyncQueue;
  deregisterPushChannels: (userId: string) => Promise<number>;
  listCalendarIds: (userId: string) => Promise<string[]>;
  redis: Pick<RedisTombstoneClient, "del" | "exists" | "set">;
}

const buildDeleteUserSyncSteps = (
  dependencies: DeleteUserSyncTeardownDependencies,
): DeleteUserTeardownStep[] => [
  {
    name: "tombstone",
    run: (userId) => markUserDeleted(dependencies.redis, userId),
    timeoutMs: TOMBSTONE_TIMEOUT_MS,
  },
  {
    name: "sync_jobs",
    run: async (userId) => {
      const calendarIds = await dependencies.listCalendarIds(userId);

      widelog.setFields({ "delete_user.calendar_count": calendarIds.length });

      if (calendarIds.length === 0) {
        return;
      }

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
    run: async (userId) => {
      const deregistered = await dependencies.deregisterPushChannels(userId);

      widelog.setFields({ "delete_user.push_channels_deregistered": deregistered });
    },
    timeoutMs: PUSH_CHANNELS_TIMEOUT_MS,
  },
];

const runWithDeadline = async (
  name: string,
  deadlineMs: number,
  run: () => Promise<void>,
): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Teardown step ${name} exceeded its ${deadlineMs}ms deadline`));
    }, deadlineMs);
  });

  try {
    await Promise.race([run(), deadline]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
};

const createDeleteUserSyncTeardown =
  (dependencies: DeleteUserSyncTeardownDependencies): DeleteUserTeardown =>
  async (userId: string) => {
    const expiresAt = Date.now() + TEARDOWN_BUDGET_MS;

    for (const step of buildDeleteUserSyncSteps(dependencies)) {
      const remainingMs = expiresAt - Date.now();
      const deadlineMs = Math.min(step.timeoutMs ?? remainingMs, remainingMs);

      try {
        if (deadlineMs <= 0) {
          throw new Error(
            `Teardown budget of ${TEARDOWN_BUDGET_MS}ms was spent before step ${step.name}`,
          );
        }

        await runWithDeadline(step.name, deadlineMs, () => step.run(userId));
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
  TEARDOWN_BUDGET_MS,
  TEARDOWN_FAILED_SLUG,
};
export type { DeleteUserSyncQueue, DeleteUserSyncTeardownDependencies };
