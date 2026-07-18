import { createPushSyncQueue } from "@keeper.sh/queue";
import type { PushSyncJobPayload } from "@keeper.sh/queue";
import type { Plan } from "@keeper.sh/data-schemas";
import { calendarsTable } from "@keeper.sh/database/schema";
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
}

interface EnqueuePushSyncDependencies {
  createQueue: () => PushSyncQueue;
  generateCorrelationId: () => string;
  getDestinationCalendarIds: (userId: string) => Promise<string[]>;
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
    await Promise.all(destinationCalendarIds.map((calendarId) => queue.add(
      `sync-${userId}-${calendarId}`,
      { calendarId, userId, plan, correlationId },
      {
        jobId: `sync-${userId}-${calendarId}-${correlationId}`,
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
  });
};

export { enqueuePushSync, runEnqueuePushSync };
export type { EnqueuePushSyncDependencies, PushSyncQueue };
