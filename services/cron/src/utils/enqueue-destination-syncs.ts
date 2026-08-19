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
 * Bounds the serial pass, which cronbake re-arms only after the callback settles. BullMQ
 * holds every command until ioredis emits "ready", so a half-open socket would park the pass
 * forever: commandTimeout never fires for a connection that is never ready.
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
     * BullMQ's disconnect() awaits an initializing promise that only settles on ioredis
     * "ready"/"error"/"end", so against a black-hole socket it parks forever. close() takes
     * the status=="initializing" branch and disconnects synchronously; disconnect() still
     * covers a connection that did come up. Each is a no-op in the other's scenario.
     */
    for (const queue of openQueues) {
      queue.close().catch(() => null);
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
