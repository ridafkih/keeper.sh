import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSerialFlushWorker } from "../../../src/core/utils/serial-flush-worker";

const RUN_DURATION_MS = 100;
// Mid-run for item A, so the lease is lost while A still holds the writer slot.
const LEASE_RECLAIM_AT_MS = 50;

/*
 * Production's persist-time currency probe marks itself consumed on entry, so the
 * run never re-probes: the item's prepare result is the only check standing between
 * a queued snapshot and its commit, and it must run after that item's queue wait.
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

    await vi.advanceTimersByTimeAsync(LEASE_RECLAIM_AT_MS);
    leaseHolder = "someone-else";

    await vi.advanceTimersByTimeAsync(RUN_DURATION_MS * 3);

    const results = await Promise.all(submissions);

    expect(
      { probeLog, resultC: results[2], runLog },
    ).toMatchObject({ resultC: "superseded-C" });
  });
});
