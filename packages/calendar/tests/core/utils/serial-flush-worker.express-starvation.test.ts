import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "../../../src/core/utils/serial-flush-worker";

/*
 * Anti-starvation contract for the express lane. Proportions mirror production:
 * budget 64 units stands in for the 64 MiB WEIGHT_BUDGET, so budget/64 = 1 is
 * the express threshold (a warm <=1024-event calendar) and weight 8 = budget/8
 * is NEVER_INGESTED_WEIGHT (a cold-start calendar).
 */
const BUDGET = 64;
const HEAVY_WEIGHT = 8;
const EXPRESS_WEIGHT = 1;
const HEAVY_HOLD_COUNT = 7;
/*
 * How many express grants may overtake a parked FIFO head before the head must
 * be admitted. Any finite bound proves fairness; 50 is generous — each cycle
 * both grants a fresh express reservation and releases the previous one, so a
 * fair lane has 50 chances to age or admit the head.
 */
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

    // Seven concurrent cold-start holds pin 56 of 64 units, spanning their provider fetches.
    const heavyHolds = await Promise.all(
      Array.from({ length: HEAVY_HOLD_COUNT }, () =>
        worker.reserve(HEAVY_WEIGHT),
      ),
    );

    // One express reservation is in flight, so outstanding sits at 57.
    let inFlightExpress = await worker.reserve(EXPRESS_WEIGHT);

    // The next cold-start reservation cannot fit (57 + 8 > 64) and parks as FIFO head.
    const headProbe = probe(worker.reserve(HEAVY_WEIGHT));
    await flushMicrotasks();
    expect(headProbe.settled).toBe(false);

    /*
     * Sustained express churn: every cycle a new 1-unit reservation is granted
     * while the head is parked, then the previous one releases. Outstanding
     * weight never drops below 57 at any grantWeight call, and express admits
     * up to the 68-unit ceiling, so nothing ever bounds the overtaking.
     */
    let overtakes = 0;
    while (overtakes < MAX_EXPRESS_OVERTAKES && !headProbe.settled) {
      const next = await worker.reserve(EXPRESS_WEIGHT);
      overtakes += 1;
      inFlightExpress.release();
      inFlightExpress = next;
      await flushMicrotasks();
    }

    /*
     * Fairness bound: a parked head must not be overtaken by express grants
     * indefinitely. On starving code the head is still pending after 50
     * overtakes — exactly the pattern that walks a cold-start source past its
     * 120s per-source deadline while warm calendars keep succeeding.
     */
    expect(headProbe.settled).toBe(true);

    inFlightExpress.release();
    for (const hold of heavyHolds) {
      hold.release();
    }
    await worker.close();
  });
});
