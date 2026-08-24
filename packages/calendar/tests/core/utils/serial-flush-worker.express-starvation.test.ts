import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "../../../src/core/utils/serial-flush-worker";

// 64 stands in for the 64 MiB WEIGHT_BUDGET, 1 for the express threshold, 8 for NEVER_INGESTED_WEIGHT.
const BUDGET = 64;
const COLD_START_WEIGHT = 8;
const EXPRESS_WEIGHT = 1;
const HEAVY_HOLD_COUNT = 7;
// Any finite bound proves fairness; 50 gives a fair lane ample chances to admit the head.
const MAX_EXPRESS_OVERTAKES = 50;

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

interface Probe {
  settled: boolean;
}

const probe = (promise: Promise<unknown>): Probe => {
  const state: Probe = { settled: false };
  promise
    .then(() => {
      state.settled = true;
      return null;
    })
    .catch(() => {
      state.settled = true;
    });
  return state;
};

describe("express lane starvation of the parked FIFO head", () => {
  it("admits a parked cold-start reservation before unbounded express traffic overtakes it", async () => {
    const worker = createSerialFlushWorker<number, number>(
      (item) => Promise.resolve(item),
      { budget: BUDGET },
    );

    const heavyHolds = await Promise.all(
      Array.from({ length: HEAVY_HOLD_COUNT }, () =>
        worker.reserve(COLD_START_WEIGHT),
      ),
    );

    let inFlightExpress = await worker.reserve(EXPRESS_WEIGHT);

    const headProbe = probe(worker.reserve(COLD_START_WEIGHT));
    await flushMicrotasks();
    expect(headProbe.settled).toBe(false);

    let overtakes = 0;
    while (overtakes < MAX_EXPRESS_OVERTAKES && !headProbe.settled) {
      const next = await worker.reserve(EXPRESS_WEIGHT);
      overtakes += 1;
      inFlightExpress.release();
      inFlightExpress = next;
      await flushMicrotasks();
    }

    // Unbounded overtaking walks a cold-start source past its 120s per-source deadline.
    expect(headProbe.settled).toBe(true);

    inFlightExpress.release();
    for (const hold of heavyHolds) {
      hold.release();
    }
    await worker.close();
  });
});
