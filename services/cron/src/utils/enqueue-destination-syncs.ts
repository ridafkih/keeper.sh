import { createPushSyncQueue } from "@keeper.sh/queue";
import type { PushSyncTrigger } from "@keeper.sh/queue";
import {
  calendarsTable,
  userSyncRequestsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, eq, inArray } from "drizzle-orm";
import env from "@/env";
import { withAbortTimeout } from "@/utils/with-abort-timeout";

import {
  runEnqueueDestinationSyncsForUsers,
  type DestinationSyncQueue,
  type EnqueueDestinationSyncDependencies,
} from "./enqueue-destination-syncs-core";

const REDIS_COMMAND_TIMEOUT_MS = 10_000;

/*
 * The whole enqueue must settle within this bound: the ingest-sources cron
 * callback awaits it before completing, and cronbake re-arms the serial pass
 * only after the callback settles. BullMQ holds every command until ioredis
 * emits "ready", so a half-open Redis socket would otherwise park the pass
 * forever — commandTimeout alone never fires for a connection that is never
 * ready.
 */
const ENQUEUE_TIMEOUT_MS = 10_000;

const enqueueDestinationSyncsForUsers = async (
  candidateUserIds: Iterable<string>,
  trigger: PushSyncTrigger = "cron",
): Promise<number> => {
  const { database, premiumService } = await import("@/context");
  const openQueues = new Set<ReturnType<typeof createPushSyncQueue>>();
  const dependencies: EnqueueDestinationSyncDependencies = {
    acknowledgePendingRequests: async (requests) => {
      if (requests.length === 0) {
        return;
      }
      await database.transaction(async (transaction) => {
        for (const request of requests) {
          await transaction
            .delete(userSyncRequestsTable)
            .where(and(
              eq(userSyncRequestsTable.userId, request.userId),
              eq(userSyncRequestsTable.requestId, request.requestId),
            ));
        }
      });
    },
    createQueue: () => {
      const queue = createPushSyncQueue({
        commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
        maxRetriesPerRequest: null,
        url: env.REDIS_URL,
      });
      openQueues.add(queue);
      return queue;
    },
    enabled: env.WORKER_JOB_QUEUE_ENABLED !== false,
    generateCorrelationId: () => crypto.randomUUID(),
    getDestinations: (userIds) => database
      .select({
        calendarId: calendarsTable.id,
        userId: calendarsTable.userId,
      })
      .from(calendarsTable)
      .where(and(
        arrayContains(calendarsTable.capabilities, ["push"]),
        eq(calendarsTable.disabled, false),
        inArray(calendarsTable.userId, userIds),
      )),
    getPendingRequests: () => database
      .select({
        requestId: userSyncRequestsTable.requestId,
        requestedAt: userSyncRequestsTable.requestedAt,
        userId: userSyncRequestsTable.userId,
      })
      .from(userSyncRequestsTable),
    resolvePlan: (userId) => premiumService.getUserPlan(userId),
  };
  try {
    return await withAbortTimeout(
      () => runEnqueueDestinationSyncsForUsers(candidateUserIds, dependencies, trigger),
      ENQUEUE_TIMEOUT_MS,
    );
  } finally {
    /*
     * A timed-out run may still hold a queue whose close() itself hangs on the
     * dead connection; force-disconnect so ioredis stops reconnecting forever.
     * Fire-and-forget: nothing after the deadline may block the serial pass.
     */
    for (const queue of openQueues) {
      queue.disconnect().catch(() => null);
    }
  }
};

export {
  enqueueDestinationSyncsForUsers,
  runEnqueueDestinationSyncsForUsers,
};
export type {
  DestinationSyncQueue,
  EnqueueDestinationSyncDependencies,
};
