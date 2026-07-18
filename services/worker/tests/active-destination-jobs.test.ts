import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createActiveDestinationJobs,
  DEFAULT_RELEASE_DELAY_MS,
} from "../src/active-destination-jobs";

const createHarness = () => {
  const beginUserRun = vi.fn();
  const cancelJob = vi.fn();
  const releaseUserRun = vi.fn();
  const tracker = createActiveDestinationJobs({
    beginUserRun,
    cancelJob,
    releaseUserRun,
  });
  return { beginUserRun, cancelJob, releaseUserRun, tracker };
};

describe("createActiveDestinationJobs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the user aggregate until every active destination settles", () => {
    vi.useFakeTimers();
    const harness = createHarness();

    harness.tracker.onActive({ calendarId: "cal-1", id: "job-1", userId: "user-1" });
    harness.tracker.onActive({ calendarId: "cal-2", id: "job-2", userId: "user-1" });
    harness.tracker.onSettled({ calendarId: "cal-1", id: "job-1", userId: "user-1" });

    expect(harness.beginUserRun).toHaveBeenCalledOnce();
    expect(harness.releaseUserRun).not.toHaveBeenCalled();

    harness.tracker.onSettled({ calendarId: "cal-2", id: "job-2", userId: "user-1" });
    vi.advanceTimersByTime(DEFAULT_RELEASE_DELAY_MS);

    expect(harness.releaseUserRun).toHaveBeenCalledOnce();
    harness.tracker.close();
  });

  it("cancels a pending idle transition when a sibling starts", () => {
    vi.useFakeTimers();
    const harness = createHarness();

    harness.tracker.onActive({ calendarId: "cal-1", id: "job-1", userId: "user-1" });
    harness.tracker.onSettled({ calendarId: "cal-1", id: "job-1", userId: "user-1" });
    vi.advanceTimersByTime(DEFAULT_RELEASE_DELAY_MS / 2);
    harness.tracker.onActive({ calendarId: "cal-2", id: "job-2", userId: "user-1" });
    vi.advanceTimersByTime(DEFAULT_RELEASE_DELAY_MS);

    expect(harness.releaseUserRun).not.toHaveBeenCalled();
    expect(harness.beginUserRun).toHaveBeenCalledOnce();

    harness.tracker.onSettled({ calendarId: "cal-2", id: "job-2", userId: "user-1" });
    vi.advanceTimersByTime(DEFAULT_RELEASE_DELAY_MS);
    expect(harness.releaseUserRun).toHaveBeenCalledOnce();
    harness.tracker.close();
  });

  it("supersedes only the older job for the same destination", () => {
    vi.useFakeTimers();
    const harness = createHarness();

    harness.tracker.onActive({ calendarId: "cal-1", id: "old", userId: "user-1" });
    harness.tracker.onActive({ calendarId: "cal-1", id: "new", userId: "user-1" });
    harness.tracker.onActive({ calendarId: "cal-2", id: "sibling", userId: "user-1" });

    expect(harness.cancelJob).toHaveBeenCalledWith("old");
    expect(harness.beginUserRun).toHaveBeenCalledOnce();

    harness.tracker.onSettled({ calendarId: "cal-1", id: "old", userId: "user-1" });
    harness.tracker.onSettled({ calendarId: "cal-1", id: "new", userId: "user-1" });
    vi.advanceTimersByTime(DEFAULT_RELEASE_DELAY_MS);
    expect(harness.releaseUserRun).not.toHaveBeenCalled();

    harness.tracker.onSettled({ calendarId: "cal-2", id: "sibling", userId: "user-1" });
    vi.advanceTimersByTime(DEFAULT_RELEASE_DELAY_MS);
    expect(harness.releaseUserRun).toHaveBeenCalledOnce();
    harness.tracker.close();
  });
});
