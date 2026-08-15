import type { Plan } from "@keeper.sh/data-schemas";
import type { PushSyncJobPayload, PushSyncTrigger } from "@keeper.sh/queue";
import type { DestinationCalendarRef } from "./get-sources";

interface PushDestinationJob {
  data: PushSyncJobPayload;
  name: string;
  opts: {
    jobId: string;
    removeOnComplete: true;
    removeOnFail: true;
  };
}

// The stable job id is load-bearing: BullMQ dedups enqueues on it.
// A running sync therefore never gains a queued replacement that supersedes or cancels it, which used to livelock.
// Correlation ids belong in job data only, never in the id.
const buildPushDestinationJobs = (
  destinations: DestinationCalendarRef[],
  plan: Plan,
  correlationId: string,
  trigger: PushSyncTrigger = "cron",
): PushDestinationJob[] => destinations
  .toSorted((first, second) =>
    first.userId.localeCompare(second.userId)
    || first.calendarId.localeCompare(second.calendarId))
  .map(({ calendarId, userId }) => ({
    name: `sync-${userId}-${calendarId}`,
    data: { calendarId, userId, plan, correlationId, trigger },
    opts: {
      jobId: `sync-${userId}-${calendarId}`,
      removeOnComplete: true,
      removeOnFail: true,
    },
  }));

export { buildPushDestinationJobs };
export type { PushDestinationJob };
