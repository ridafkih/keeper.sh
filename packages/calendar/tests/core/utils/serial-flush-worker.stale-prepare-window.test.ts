import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSerialFlushWorker } from "../../../src/core/utils/serial-flush-worker";

// Each flushDatabase run holds the serial writer slot this long.
const RUN_DURATION_MS = 100;
// The lease is reclaimed while item A's run is still on the slot.
const LEASE_RECLAIM_AT_MS = 50;

/*
 * The production ingest caller attaches the persist-time Redis currency probe
 * as the item's `prepare` (services/cron/src/jobs/ingest-sources.ts:633), and
 * the probe marks itself consumed on entry (ingest.ts persistProbePending), so
 * the run NEVER re-probes: the prepare result is the only currency check that
 * stands between a queued snapshot and its flushDatabase commit.
 *
 * The worker documents that the preparation runs "after this item's queue
 * wait" (serial-flush-worker.ts:93-101) and that the settled-prepare-to-run
 * gap "stays as small as the runs already in flight" (:170-175). This test
 * pins the behavioral consequence of that contract: a sync lease reclaimed
 * while EARLIER items' runs are still draining must be observed by a LATER
 * item's probe, so its stale snapshot short-circuits instead of committing
 * over the fresher holder's data.
 */
interface ProbeCarryingItem {
  name: string;
  prepare: () => Promise<string | null>;
  task: () => Promise<string>;
}

describe("serial flush worker persist-time probe staleness under queue depth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("short-circuits a queued item whose lease was lost before its run slot", async () => {
    const startedAt = Date.now();
    let leaseHolder = "me";
    const probeLog: string[] = [];
    const runLog: string[] = [];

    const worker = createSerialFlushWorker(
      async (item: ProbeCarryingItem) => await item.task(),
    );

    const makeItem = (name: string): ProbeCarryingItem => ({
      name,
      prepare: (): Promise<string | null> => {
        probeLog.push(`probe ${name} at ${Date.now() - startedAt}ms lease=${leaseHolder}`);
        if (leaseHolder === "me") {
          return Promise.resolve(null);
        }
        return Promise.resolve(`superseded-${name}`);
      },
      task: (): Promise<string> =>
        new Promise((resolve) => {
          runLog.push(`run ${name} at ${Date.now() - startedAt}ms lease=${leaseHolder}`);
          setTimeout(() => {
            resolve(`committed-${name}`);
          }, RUN_DURATION_MS);
        }),
    });

    const submissions = [
      worker.submit(makeItem("A")),
      worker.submit(makeItem("B")),
      worker.submit(makeItem("C")),
    ];
    // Swallow interim rejections so a short-circuit cannot trip unhandled-rejection noise.
    for (const submission of submissions) {
      submission.catch(() => "rejected");
    }

    /*
     * The lease is reclaimed while A's run still holds the writer slot; a
     * fresher holder commits from here on.
     */
    await vi.advanceTimersByTimeAsync(LEASE_RECLAIM_AT_MS);
    leaseHolder = "someone-else";

    // Drain all three serial runs (A finishes at 100ms, B at 200ms, C at 300ms).
    await vi.advanceTimersByTimeAsync(RUN_DURATION_MS * 3);

    const results = await Promise.all(submissions);

    /*
     * C's run slot opens at ~200ms, long after the lease was lost at 50ms.
     * A probe that ran after C's queue wait — the worker's documented
     * contract — sees lease=someone-else and must short-circuit, keeping the
     * stale snapshot out of the database. If C instead reports
     * "committed-C", its probe fired for the whole backlog in one pump
     * sweep at ~0ms and its stale flush overwrote the fresher writer.
     */
    expect(
      { probeLog, resultC: results[2], runLog },
    ).toMatchObject({ resultC: "superseded-C" });
  });
});
