import type { Plan } from "@keeper.sh/data-schemas";
import type { PushSyncTrigger } from "@keeper.sh/queue";
import { widelog } from "@/utils/logging";
import type { PushDestinationJob } from "./push-destination-jobs";
import { buildPushDestinationJobs } from "./push-destination-jobs";

interface InFlightPushSyncJob {
  timestamp: number;
}

interface PendingSyncRequest {
  requestId: string;
  requestedAt: Date;
  userId: string;
}

interface DestinationSyncQueue {
  addBulk: (jobs: PushDestinationJob[]) => Promise<unknown>;
  close: () => Promise<void>;
  getJob: (jobId: string) => Promise<InFlightPushSyncJob | null | undefined>;
}

interface EnqueueDestinationSyncDependencies {
  acknowledgePendingRequests?: (requests: PendingSyncRequest[]) => Promise<void>;
  createQueue: () => DestinationSyncQueue;
  enabled: boolean;
  generateCorrelationId: () => string;
  getDestinations: (userIds: string[]) => Promise<{ calendarId: string; userId: string }[]>;
  getPendingRequests?: () => Promise<PendingSyncRequest[]>;
  resolvePlan: (userId: string) => Promise<Plan | null>;
}

const runEnqueueDestinationSyncsForUsers = async (
  candidateUserIds: Iterable<string>,
  dependencies: EnqueueDestinationSyncDependencies,
  trigger: PushSyncTrigger = "cron",
): Promise<number> => {
  if (!dependencies.enabled) {
    return 0;
  }

  const pendingRequests = await dependencies.getPendingRequests?.() ?? [];
  const userIds = [...new Set([
    ...candidateUserIds,
    ...pendingRequests.map(({ userId }) => userId),
  ])].toSorted();
  if (userIds.length === 0) {
    return 0;
  }

  const destinations = await dependencies.getDestinations(userIds);
  if (destinations.length === 0) {
    await dependencies.acknowledgePendingRequests?.(pendingRequests);
    return 0;
  }

  const plansByUserId = new Map<string, Plan>();
  const destinationUserIds = [...new Set(
    destinations.map(({ userId }) => userId),
  )];
  await Promise.all(destinationUserIds.map(async (userId) => {
    const plan = await dependencies.resolvePlan(userId);
    if (!plan) {
      throw new Error(`Unable to resolve user plan for ingestion sync enqueue: ${userId}`);
    }
    plansByUserId.set(userId, plan);
  }));

  const pendingUserIds = new Set(
    pendingRequests.map(({ userId }) => userId),
  );
  const eligibleDestinations = destinations.filter(({ userId }) =>
    pendingUserIds.has(userId) || plansByUserId.get(userId) === "pro");

  const correlationId = dependencies.generateCorrelationId();
  widelog.set("correlation.id", correlationId);
  const jobs = (["free", "pro"] as const).flatMap((plan) =>
    buildPushDestinationJobs(
      eligibleDestinations.filter(
        (destination) => plansByUserId.get(destination.userId) === plan,
      ),
      plan,
      correlationId,
      trigger,
    ));
  widelog.set("push_drain.jobs_enqueued", jobs.length);
  if (jobs.length === 0) {
    await dependencies.acknowledgePendingRequests?.(pendingRequests);
    return 0;
  }

  const queue = dependencies.createQueue();
  try {
    // Only a job predating the request can miss changes it already read past.
    // Retaining against a newer job would never terminate.
    // Free users whose sync outlives the tick would sit on the Pro cadence forever.
    const existingJobs = await Promise.all(
      jobs.map((job) => queue.getJob(job.opts.jobId)),
    );
    await queue.addBulk(jobs);
    const requestedAtByUserId = new Map(pendingRequests.map(
      ({ requestedAt, userId }) => [userId, requestedAt.getTime()],
    ));
    const retainedUserIds = new Set(jobs
      .filter((job, index) => {
        const existingJob = existingJobs.at(index);
        if (!existingJob) {
          return false;
        }
        return existingJob.timestamp < (requestedAtByUserId.get(job.data.userId) ?? 0);
      })
      .map((job) => job.data.userId));
    await dependencies.acknowledgePendingRequests?.(
      pendingRequests.filter(({ userId }) => !retainedUserIds.has(userId)),
    );
  } finally {
    await queue.close();
  }
  return jobs.length;
};
export { runEnqueueDestinationSyncsForUsers };
export type { DestinationSyncQueue, EnqueueDestinationSyncDependencies };
