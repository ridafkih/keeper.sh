import { createPushSyncQueue, runEnqueuePushSync } from "@keeper.sh/queue";
import type { EnqueuePushSyncDependencies, PushSyncQueue } from "@keeper.sh/queue";
import { listPushDestinationCalendarIds, recordUserSyncRequest } from "@keeper.sh/sync";
import type { Plan } from "@keeper.sh/data-schemas";

const enqueuePushSync = async (userId: string, plan: Plan): Promise<void> => {
  const { database, env } = await import("@/context");

  return runEnqueuePushSync(userId, plan, {
    createQueue: () => createPushSyncQueue({ url: env.REDIS_URL, maxRetriesPerRequest: null }),
    generateCorrelationId: () => crypto.randomUUID(),
    getDestinationCalendarIds: (destinationUserId) =>
      listPushDestinationCalendarIds(database, destinationUserId),
    recordSyncRequest: (requestUserId) => recordUserSyncRequest(database, requestUserId),
  });
};

export { enqueuePushSync, runEnqueuePushSync };
export type { EnqueuePushSyncDependencies, PushSyncQueue };
