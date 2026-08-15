import { createPushSyncQueue } from "@keeper.sh/queue";
import type { PushSyncTrigger } from "@keeper.sh/queue";
import {
  calendarsTable,
  userSyncRequestsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, eq, inArray } from "drizzle-orm";
import env from "@/env";

import {
  runEnqueueDestinationSyncsForUsers,
  type DestinationSyncQueue,
  type EnqueueDestinationSyncDependencies,
} from "./enqueue-destination-syncs-core";


const enqueueDestinationSyncsForUsers = async (
  candidateUserIds: Iterable<string>,
  trigger: PushSyncTrigger = "cron",
): Promise<number> => {
  const { database, premiumService } = await import("@/context");
  return runEnqueueDestinationSyncsForUsers(candidateUserIds, {
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
    createQueue: () => createPushSyncQueue({ url: env.REDIS_URL, maxRetriesPerRequest: null }),
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
  }, trigger);
};

export {
  enqueueDestinationSyncsForUsers,
  runEnqueueDestinationSyncsForUsers,
};
export type {
  DestinationSyncQueue,
  EnqueueDestinationSyncDependencies,
};
