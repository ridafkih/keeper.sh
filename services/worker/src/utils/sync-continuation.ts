import type { Job } from "bullmq";
import { resolvePushSyncJobId } from "@keeper.sh/queue";
import type { PushSyncJobPayload, PushSyncJobResult } from "@keeper.sh/queue";

interface ContinuationQueue {
  add: (
    name: string,
    data: PushSyncJobPayload,
    options: { jobId: string; priority: number; removeOnComplete: true; removeOnFail: true },
  ) => Promise<unknown>;
}

interface DeadlineOutcome {
  deadlineReached: boolean;
  checkpointedOperations: number;
}

const CONTINUATION_PRIORITY_BY_TRIGGER = { push: 1, cron: 2 } as const;

const shouldContinueAfterDeadline = ({ deadlineReached, checkpointedOperations }: DeadlineOutcome): boolean =>
  deadlineReached && checkpointedOperations > 0;

type FinishedPushSyncJob = Pick<Job<PushSyncJobPayload, PushSyncJobResult>, "data" | "returnvalue">;

const requestsContinuation = (job: FinishedPushSyncJob): boolean =>
  job.returnvalue?.continuationRequested === true;

const enqueueSyncContinuation = async (
  queue: ContinuationQueue,
  job: FinishedPushSyncJob,
): Promise<boolean> => {
  if (!requestsContinuation(job)) {
    return false;
  }
  const { webhookReceivedAt: _webhookReceivedAt, ...data } = job.data;
  const trigger = data.trigger ?? "cron";
  const jobId = resolvePushSyncJobId(data.userId, data.calendarId);
  await queue.add(jobId, data, {
    jobId,
    priority: CONTINUATION_PRIORITY_BY_TRIGGER[trigger],
    removeOnComplete: true,
    removeOnFail: true,
  });
  return true;
};

export { enqueueSyncContinuation, requestsContinuation, shouldContinueAfterDeadline };
export type { ContinuationQueue, DeadlineOutcome, FinishedPushSyncJob };
