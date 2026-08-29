import { createPushSyncQueue, syncJobId } from "@keeper.sh/queue";
import type { PushSyncJobPayload } from "@keeper.sh/queue";
import type { Plan } from "@keeper.sh/data-schemas";
import { calendarsTable, userSyncRequestsTable } from "@keeper.sh/database/schema";
import { and, arrayContains, eq } from "drizzle-orm";

interface PushSyncJobOptions {
  jobId: string;
  removeOnComplete: boolean;
  removeOnFail: boolean;
}

interface PushSyncQueue {
  add: (
    name: string,
    data: PushSyncJobPayload,
    options: PushSyncJobOptions,
  ) => Promise<unknown>;
  close: () => Promise<void>;
  getJob: (jobId: string) => Promise<unknown>;
}

interface EnqueuePushSyncDependencies {
  createQueue: () => PushSyncQueue;
  generateCorrelationId: () => string;
  getDestinationCalendarIds: (userId: string) => Promise<string[]>;
  recordSyncRequest: (userId: string) => Promise<void>;
}

const runEnqueuePushSync = async (
  userId: string,
  plan: Plan,
  dependencies: EnqueuePushSyncDependencies,
): Promise<void> => {
  const correlationId = dependencies.generateCorrelationId();
  const destinationCalendarIds = await dependencies.getDestinationCalendarIds(userId);
  if (destinationCalendarIds.length === 0) {
    return;
  }
  const queue = dependencies.createQueue();

  try {
    // A stable job id means an in-flight sync dedups this enqueue.
    // The durable request row lets the cron drain retry once that sync finishes.
    // Recorded before the add so a crash in between cannot drop the request.
    const existingJobs = await Promise.all(destinationCalendarIds.map(
      (calendarId) => queue.getJob(syncJobId(userId, calendarId)),
    ));
    if (existingJobs.some(Boolean)) {
      await dependencies.recordSyncRequest(userId);
    }
    await Promise.all(destinationCalendarIds.map((calendarId) => queue.add(
      syncJobId(userId, calendarId),
      { calendarId, userId, plan, correlationId },
      {
        jobId: syncJobId(userId, calendarId),
        removeOnComplete: true,
        removeOnFail: true,
      },
    )));
  } finally {
    await queue.close();
  }
};

const enqueuePushSync = async (userId: string, plan: Plan): Promise<void> => {
  const { database, env } = await import("@/context");

  return runEnqueuePushSync(userId, plan, {
    createQueue: () => createPushSyncQueue({ url: env.REDIS_URL, maxRetriesPerRequest: null }),
    generateCorrelationId: () => crypto.randomUUID(),
    getDestinationCalendarIds: async (destinationUserId) => {
      const destinations = await database
        .select({ calendarId: calendarsTable.id })
        .from(calendarsTable)
        .where(and(
          eq(calendarsTable.userId, destinationUserId),
          eq(calendarsTable.disabled, false),
          arrayContains(calendarsTable.capabilities, ["push"]),
        ));
      return destinations.map(({ calendarId }) => calendarId);
    },
    recordSyncRequest: async (requestUserId) => {
      const requestId = crypto.randomUUID();
      const requestedAt = new Date();
      await database
        .insert(userSyncRequestsTable)
        .values({ requestId, requestedAt, userId: requestUserId })
        .onConflictDoUpdate({
          target: userSyncRequestsTable.userId,
          set: { requestId, requestedAt },
        });
    },
  });
};

export { enqueuePushSync, runEnqueuePushSync };
export type { EnqueuePushSyncDependencies, PushSyncQueue };
