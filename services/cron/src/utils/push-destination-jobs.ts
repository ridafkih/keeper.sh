import type { Plan } from "@keeper.sh/data-schemas";
import type { PushSyncJobPayload } from "@keeper.sh/queue";
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

const buildPushDestinationJobs = (
  destinations: DestinationCalendarRef[],
  plan: Plan,
  correlationId: string,
): PushDestinationJob[] => destinations
  .toSorted((first, second) =>
    first.userId.localeCompare(second.userId)
    || first.calendarId.localeCompare(second.calendarId))
  .map(({ calendarId, userId }) => ({
    name: `sync-${userId}-${calendarId}`,
    data: { calendarId, userId, plan, correlationId },
    opts: {
      jobId: `sync-${userId}-${calendarId}`,
      removeOnComplete: true,
      removeOnFail: true,
    },
  }));

export { buildPushDestinationJobs };
export type { PushDestinationJob };
