import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSerialFlushWorker } from "../../../src/core/utils/serial-flush-worker";

const DEFAULT_RUN_DEADLINE_MS = 600_000;
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
 * Production submits thunk items, so the item carrying its own deadlineAt is a
 * function with a property — not the plain object shape the worker's own tests use.
 */
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

    await vi.advanceTimersByTimeAsync(ITEM_DEADLINE_MS);
    expect(ITEM_DEADLINE_MS).toBeLessThan(DEFAULT_RUN_DEADLINE_MS);
    expect(submitted.status).toBe("rejected");
  });
});
