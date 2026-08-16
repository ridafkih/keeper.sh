import { createPushSyncQueue, runEnqueuePushSync } from "@keeper.sh/queue";
import type { PushSyncJobPayload } from "@keeper.sh/queue";
import { listPushDestinationCalendarIds, recordUserSyncRequest } from "@keeper.sh/sync";
import { database } from "../context";
import env from "../env";

/*
 * The same enqueue the API performs on a source mutation, bound for the worker so a
 * write-back can wake the user's other destinations without reaching into a service.
 */
const enqueuePushSync = (
  userId: string,
  plan: PushSyncJobPayload["plan"],
): Promise<void> =>
  runEnqueuePushSync(userId, plan, {
    createQueue: () => createPushSyncQueue({ url: env.REDIS_URL, maxRetriesPerRequest: null }),
    generateCorrelationId: () => crypto.randomUUID(),
    getDestinationCalendarIds: (destinationUserId) =>
      listPushDestinationCalendarIds(database, destinationUserId),
    recordSyncRequest: (requestUserId) => recordUserSyncRequest(database, requestUserId),
  });

export { enqueuePushSync };
