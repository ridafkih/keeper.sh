import { describe, expect, it } from "vitest";
import { buildPushDestinationJobs } from "../../src/utils/push-destination-jobs";

describe("buildPushDestinationJobs", () => {
  it("creates an independent job for every destination calendar", () => {
    const jobs = buildPushDestinationJobs([
      { calendarId: "outlook", userId: "user-1" },
      { calendarId: "google", userId: "user-2" },
      { calendarId: "fastmail", userId: "user-1" },
    ], "pro", "run-1");

    expect(jobs.map(({ data }) => data)).toEqual([
      { calendarId: "fastmail", correlationId: "run-1", plan: "pro", userId: "user-1" },
      { calendarId: "outlook", correlationId: "run-1", plan: "pro", userId: "user-1" },
      { calendarId: "google", correlationId: "run-1", plan: "pro", userId: "user-2" },
    ]);
    expect(jobs.map(({ opts }) => opts.jobId)).toEqual([
      "sync-user-1-fastmail",
      "sync-user-1-outlook",
      "sync-user-2-google",
    ]);
  });
});
