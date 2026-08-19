import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSerialFlushWorker } from "../../../src/core/utils/serial-flush-worker";

// The generic client-side fallback bound baked into the worker.
const DEFAULT_RUN_DEADLINE_MS = 600_000;
// A per-source deadline far below the fallback, as ingest-sources computes one.
const ITEM_DEADLINE_MS = 5000;

interface SettlementProbe {
  status: "pending" | "rejected" | "resolved";
}

const probe = (promise: Promise<unknown>): SettlementProbe => {
  const state: SettlementProbe = { status: "pending" };
  promise
    .then(() => {
      state.status = "resolved";
      return null;
    })
    .catch(() => {
      state.status = "rejected";
    });
  return state;
};

/*
 * The production caller (services/cron/src/jobs/ingest-sources.ts) instantiates
 * the worker with thunk items: `(task: () => Promise<IngestionResult>) => task()`.
 * The worker documents "Honor an item-carried absolute deadline when present",
 * so a thunk carrying its source's own `deadlineAt` must be bounded by that
 * deadline, not by the generic ten-minute fallback.
 */
// A half-open connection: the flush stays pending forever.
const wedged = (): Promise<number> =>
  new Promise<number>(() => {
    // Intentionally never settles, modeling a half-open connection.
  });

interface DeadlineCarryingTask {
  (): Promise<number>;
  deadlineAt: number;
}

describe("createSerialFlushWorker item-carried deadline on production-shaped items", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("honors deadlineAt carried on a thunk item instead of the 10-minute fallback", async () => {
    const worker = createSerialFlushWorker((task: () => Promise<number>) => task());

    const task = Object.assign(wedged, {
      deadlineAt: Date.now() + ITEM_DEADLINE_MS,
    }) as DeadlineCarryingTask;

    const submitted = probe(worker.submit(task));

    // Advance to the item's own deadline; well short of the generic fallback.
    await vi.advanceTimersByTimeAsync(ITEM_DEADLINE_MS);
    expect(ITEM_DEADLINE_MS).toBeLessThan(DEFAULT_RUN_DEADLINE_MS);
    /*
     * The item carried a finite absolute deadline, so the worker must reject
     * the wedged flush here — not park it for the remaining ~595 seconds of
     * the generic fallback while the source's own deadline has already passed.
     */
    expect(submitted.status).toBe("rejected");
  });
});
