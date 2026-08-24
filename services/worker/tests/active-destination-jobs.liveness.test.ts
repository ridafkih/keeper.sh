import { afterEach, describe, expect, it, vi } from "vitest";
import { createActiveDestinationJobs } from "../src/active-destination-jobs";

/*
 * Liveness guards for the process-local destination-job bookkeeping.
 *
 * `activeDestinationCountsByUser` is in-memory with no expiry, and
 * `releaseUserRun` fires only when it returns to zero. Any BullMQ job that
 * becomes active without ever emitting `completed` or `failed` therefore pins
 * the user's syncing hold for the lifetime of the worker process, which only a
 * restart clears.
 *
 * BullMQ can drop the settle event. In `worker.js` both terminal paths emit the
 * event only AFTER a Redis round-trip that can throw:
 *
 *   async handleCompleted(...) {
 *     if (!this.connection.closing) {
 *       const completed = await job.moveToCompleted(result, token, ...);
 *       this.emit('completed', job, result, 'active');
 *
 *   async handleFailed(...) {
 *     if (!this.connection.closing) {
 *       ...
 *       const result = await job.moveToFailed(err, token, ...);
 *       this.emit('failed', job, err, 'active');
 *
 * If `moveToCompleted` rejects — the "Missing lock for job" case after the job
 * stalls and the stalled-checker reclaims it, or any transient Redis error —
 * neither event is emitted for that job on this worker.
 *
 * These tests are RED against the current implementation.
 */

const createHarness = (releaseDelayMs?: number) => {
  const beginUserRun = vi.fn();
  const releaseUserRun = vi.fn();
  const tracker = createActiveDestinationJobs({
    beginUserRun,
    releaseUserRun,
    ...(typeof releaseDelayMs === "number" && { releaseDelayMs }),
  });
  return { beginUserRun, releaseUserRun, tracker };
};

describe("active destination job liveness", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("releases the user aggregate when an active job never settles", () => {
    vi.useFakeTimers();
    const harness = createHarness();

    harness.tracker.onActive({ calendarId: "cal-1", id: "job-1", userId: "user-1" });
    expect(harness.beginUserRun).toHaveBeenCalledOnce();

    /*
     * The first job never emits completed or failed. A sibling destination for
     * the same user runs a full, healthy cycle in the meantime.
     */
    harness.tracker.onActive({ calendarId: "cal-2", id: "job-2", userId: "user-1" });
    harness.tracker.onSettled({ calendarId: "cal-2", id: "job-2", userId: "user-1" });

    // An hour of wall clock: far beyond BullMQ's 360s lock duration and the
    // 300s job deadline, so job-1 cannot still be running.
    vi.advanceTimersByTime(60 * 60 * 1000);

    expect(harness.releaseUserRun).toHaveBeenCalledWith("user-1");
    harness.tracker.close();
  });

  /*
   * GREEN — documents the bound on the leak above. A lost settle event is
   * reclaimed as soon as the SAME calendar becomes active again, because the
   * stale map entry is matched and cleared by that run's own settle. The leak
   * is therefore permanent only for a calendar that never runs again on this
   * worker (destination deleted, disabled, or in a 6h backoff).
   */
  it("reclaims a lost settle when the same calendar syncs again", () => {
    vi.useFakeTimers();
    const harness = createHarness();

    harness.tracker.onActive({ calendarId: "cal-1", id: "job-1", userId: "user-1" });
    /* The settle event for this job is lost. */

    /*
     * Post-deploy, job ids are stable (`sync-${userId}-${calendarId}`), so the
     * next run for this calendar reuses the same id and hits the
     * `previous.id === job.id` early return without re-incrementing.
     */
    harness.tracker.onActive({ calendarId: "cal-1", id: "job-1", userId: "user-1" });
    harness.tracker.onSettled({ calendarId: "cal-1", id: "job-1", userId: "user-1" });
    vi.advanceTimersByTime(60 * 60 * 1000);

    expect(harness.releaseUserRun).toHaveBeenCalledWith("user-1");
    harness.tracker.close();
  });

  it("flushes a pending release when the worker shuts down", () => {
    vi.useFakeTimers();
    const harness = createHarness(2000);

    harness.tracker.onActive({ calendarId: "cal-1", id: "job-1", userId: "user-1" });
    harness.tracker.onSettled({ calendarId: "cal-1", id: "job-1", userId: "user-1" });

    /*
     * Shutdown calls activeDestinationJobs.close() before worker.close(), so a
     * release scheduled inside the 2s debounce is discarded and the user is
     * left holding a syncing aggregate that nothing will ever clear.
     */
    harness.tracker.close();
    vi.advanceTimersByTime(10_000);

    expect(harness.releaseUserRun).toHaveBeenCalledWith("user-1");
  });
});
