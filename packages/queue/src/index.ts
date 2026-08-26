import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import type { Plan } from "@keeper.sh/data-schemas";

const PUSH_SYNC_QUEUE_NAME = "push-sync-v2";
const USER_TIMEOUT_MS = 300_000;

type PushSyncTrigger = "cron" | "push";

/*
 * `trigger` and `webhookReceivedAt` reflect the FIRST enqueue: the stable jobId makes
 * addBulk a no-op when a job with that id already exists, exactly like BullMQ's own
 * job.timestamp, so the fields stay mutually consistent.
 *
 * `webhookReceivedAt` is absent for a cron sync, which has no originating webhook. A zero
 * would read as a real measurement and drag every latency quantile to the floor.
 */
interface PushSyncJobPayload {
  calendarId: string;
  userId: string;
  plan: Plan;
  correlationId: string;
  trigger?: PushSyncTrigger;
  webhookReceivedAt?: number;
}

interface PushSyncJobResult {
  added: number;
  addFailed: number;
  removed: number;
  removeFailed: number;
  errors: string[];
}

const createPushSyncQueue = (connection: ConnectionOptions): Queue<PushSyncJobPayload, PushSyncJobResult> =>
  new Queue(PUSH_SYNC_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 1,
    },
  });

const syncJobId = (userId: string, calendarId: string) => `sync-${userId}-${calendarId}`;

const removalFailureMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

interface SyncJobRemovalFailure {
  jobId: string;
  message: string;
}

interface SyncJobRemovalResult {
  removedJobId?: string;
  unremovableJobId?: string;
  failure?: SyncJobRemovalFailure;
}

interface RemoveUserSyncJobsOutcome {
  removedJobIds: string[];
  unremovableJobIds: string[];
  failures: SyncJobRemovalFailure[];
}

interface SyncJobQueue {
  getJob?: (jobId: string) => Promise<unknown>;
  remove: (jobId: string) => Promise<number>;
}

const classifyRemoval = (
  jobId: string,
  wasQueued: boolean,
  removedCount: number,
): SyncJobRemovalResult => {
  if (!wasQueued) {
    return {};
  }

  if (removedCount > 0) {
    return { removedJobId: jobId };
  }

  return { unremovableJobId: jobId };
};

const removeUserSyncJobs = async (
  queue: SyncJobQueue,
  userId: string,
  calendarIds: string[],
): Promise<RemoveUserSyncJobsOutcome> => {
  const lookUpQueuedJob = queue.getJob?.bind(queue) ?? null;

  const results = await Promise.all(
    calendarIds.map(async (calendarId): Promise<SyncJobRemovalResult> => {
      const jobId = syncJobId(userId, calendarId);

      try {
        const wasQueued = lookUpQueuedJob === null || Boolean(await lookUpQueuedJob(jobId));

        return classifyRemoval(jobId, wasQueued, await queue.remove(jobId));
      } catch (error) {
        return { failure: { jobId, message: removalFailureMessage(error) } };
      }
    }),
  );

  return {
    removedJobIds: results.flatMap((result) => result.removedJobId ?? []),
    unremovableJobIds: results.flatMap((result) => result.unremovableJobId ?? []),
    failures: results.flatMap((result) => result.failure ?? []),
  };
};

export { PUSH_SYNC_QUEUE_NAME, USER_TIMEOUT_MS, createPushSyncQueue, removeUserSyncJobs };
export type {
  PushSyncJobPayload,
  PushSyncJobResult,
  PushSyncTrigger,
  RemoveUserSyncJobsOutcome,
  SyncJobQueue,
  SyncJobRemovalFailure,
};
