import { describe, expect, it } from "vitest";
import { removeUserSyncJobs, syncJobId } from "../src/index";
import { runEnqueuePushSync } from "../../../services/api/src/utils/enqueue-push-sync";
import type { PushSyncQueue } from "../../../services/api/src/utils/enqueue-push-sync";
import { buildPushDestinationJobs } from "../../../services/cron/src/utils/push-destination-jobs";

const USER_ID = "user-1";
const CALENDAR_IDS = ["cal-a", "cal-b"];

const enqueuedJobIdsFromApi = async (): Promise<string[]> => {
  const jobIds: string[] = [];
  const queue: PushSyncQueue = {
    add: (unusedName, unusedData, options) => {
      jobIds.push(options.jobId);
      return Promise.resolve(null);
    },
    close: () => Promise.resolve(),
    getJob: () => Promise.resolve(null),
  };

  await runEnqueuePushSync(USER_ID, "pro", {
    createQueue: () => queue,
    generateCorrelationId: () => "correlation-1",
    getDestinationCalendarIds: () => Promise.resolve(CALENDAR_IDS),
    recordSyncRequest: () => Promise.resolve(),
  });

  return jobIds;
};

const enqueuedJobIdsFromCron = (): string[] =>
  buildPushDestinationJobs(
    CALENDAR_IDS.map((calendarId) => ({ calendarId, userId: USER_ID })),
    "pro",
    () => "correlation-1",
  ).map((job) => job.opts.jobId);

const removalAttemptedJobIds = async (): Promise<string[]> => {
  const removeAttempts: string[] = [];

  await removeUserSyncJobs(
    {
      remove: (jobId: string) => {
        removeAttempts.push(jobId);
        return Promise.resolve(1);
      },
    },
    USER_ID,
    CALENDAR_IDS,
  );

  return removeAttempts;
};

describe("the sync job id has one definition", () => {
  it("derives every producer id and the removal id from the shared helper", async () => {
    const shared = CALENDAR_IDS.map((calendarId) => syncJobId(USER_ID, calendarId)).toSorted();

    const apiJobIds = await enqueuedJobIdsFromApi();
    const removalJobIds = await removalAttemptedJobIds();

    expect(shared).toEqual(apiJobIds.toSorted());
    expect(shared).toEqual(enqueuedJobIdsFromCron().toSorted());
    expect(shared).toEqual(removalJobIds.toSorted());
  });
});
