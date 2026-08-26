import { eq } from "drizzle-orm";
import { markUserDeleted } from "@keeper.sh/calendar";
import { createPushSyncQueue, removeUserSyncJobs } from "@keeper.sh/queue";
import { calendarsTable } from "@keeper.sh/database/schema";
import { widelog } from "@/utils/logging";
import { deregisterUserPushChannels } from "@/utils/push-notifications/deregister-account-channels";
import type { RedisTombstoneClient } from "@keeper.sh/calendar";
import type { DeleteUserTeardown, DeleteUserTeardownStep } from "@keeper.sh/auth";

const TEARDOWN_FAILED_SLUG = "delete-user-teardown-failed";

interface DeleteUserSyncQueue {
  remove: (jobId: string) => Promise<number>;
}

interface DeleteUserSyncTeardownDependencies {
  createQueue: () => DeleteUserSyncQueue;
  deregisterPushChannels: (userId: string) => Promise<number>;
  listCalendarIds: (userId: string) => Promise<string[]>;
  redis: Pick<RedisTombstoneClient, "set">;
}

const buildDeleteUserSyncSteps = (
  dependencies: DeleteUserSyncTeardownDependencies,
): DeleteUserTeardownStep[] => [
  {
    name: "tombstone",
    run: (userId) => markUserDeleted(dependencies.redis, userId),
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
      });

      if (outcome.failures.length > 0) {
        const details = outcome.failures
          .map((failure) => `${failure.jobId}: ${failure.message}`)
          .join("; ");
        throw new Error(`Failed to remove queued sync jobs for user ${userId} — ${details}`);
      }
    },
  },
  {
    name: "push_channels",
    run: async (userId) => {
      const deregistered = await dependencies.deregisterPushChannels(userId);

      widelog.setFields({ "delete_user.push_channels_deregistered": deregistered });
    },
  },
];

const createDeleteUserSyncTeardown =
  (dependencies: DeleteUserSyncTeardownDependencies): DeleteUserTeardown =>
  async (userId: string) => {
    for (const step of buildDeleteUserSyncSteps(dependencies)) {
      try {
        await step.run(userId);
      } catch (error) {
        widelog.errorFields(error, {
          prefix: `delete_user_teardown.${step.name}`,
          retriable: false,
          slug: TEARDOWN_FAILED_SLUG,
        });
      }
    }
  };

let pushSyncQueue: DeleteUserSyncQueue | null = null;

const resolvePushSyncQueue = (redisUrl: string): DeleteUserSyncQueue => {
  pushSyncQueue ??= createPushSyncQueue({ url: redisUrl, maxRetriesPerRequest: null });
  return pushSyncQueue;
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

export { createDeleteUserSyncTeardown, deleteUserSyncTeardown, TEARDOWN_FAILED_SLUG };
export type { DeleteUserSyncQueue, DeleteUserSyncTeardownDependencies };
