import type { Plan } from "@keeper.sh/data-schemas";
import type { PushSyncJobPayload } from "./index";

const NO_DESTINATIONS = 0;

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
  if (destinationCalendarIds.length === NO_DESTINATIONS) {
    return;
  }
  const queue = dependencies.createQueue();

  try {
    // A stable job id means an in-flight sync dedups this enqueue.
    // The durable request row lets the cron drain retry once that sync finishes.
    // Recorded before the add so a crash in between cannot drop the request.
    const existingJobs = await Promise.all(destinationCalendarIds.map(
      (calendarId) => queue.getJob(`sync-${userId}-${calendarId}`),
    ));
    if (existingJobs.some(Boolean)) {
      await dependencies.recordSyncRequest(userId);
    }
    await Promise.all(destinationCalendarIds.map((calendarId) => queue.add(
      `sync-${userId}-${calendarId}`,
      { calendarId, userId, plan, correlationId },
      {
        jobId: `sync-${userId}-${calendarId}`,
        removeOnComplete: true,
        removeOnFail: true,
      },
    )));
  } finally {
    await queue.close();
  }
};

export { runEnqueuePushSync };
export type { EnqueuePushSyncDependencies, PushSyncJobOptions, PushSyncQueue };
