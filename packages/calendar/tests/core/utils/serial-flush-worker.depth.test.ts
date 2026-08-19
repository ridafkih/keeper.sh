import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "../../../src/core/utils/serial-flush-worker";

const WRITER_CONCURRENCY = 2;
const CAPACITY = 50;
const BUDGET = 100;
const HALF_BUDGET_WEIGHT = 60;
const SUBMISSIONS = 5;

const settle = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

const finished: Promise<null> = Promise.resolve(null);

describe("serial flush worker depth", () => {
  it("reports no contention while idle", () => {
    const worker = createSerialFlushWorker((task: () => Promise<null>) => task(), {
      budget: BUDGET,
      capacity: CAPACITY,
      writerConcurrency: WRITER_CONCURRENCY,
    });

    expect(worker.depth()).toEqual({
      parkedOnBudget: 0,
      queuedFlushes: 0,
      writerSlotsInUse: 0,
    });
  });

  it("reports queued flushes and writer slots while the writers are saturated", async () => {
    const gate = Promise.withResolvers<null>();
    const worker = createSerialFlushWorker(
      async (task: () => Promise<null>) => {
        await gate.promise;
        return await task();
      },
      { capacity: CAPACITY, writerConcurrency: WRITER_CONCURRENCY },
    );

    const submissions = Array.from({ length: SUBMISSIONS }, () => worker.submit(() => finished));
    await settle();

    const saturated = worker.depth();
    expect(saturated.writerSlotsInUse).toBe(WRITER_CONCURRENCY);
    expect(saturated.queuedFlushes).toBe(SUBMISSIONS - WRITER_CONCURRENCY);
    expect(saturated.parkedOnBudget).toBe(0);

    gate.resolve(null);
    await Promise.all(submissions);
    await worker.close();

    expect(worker.depth()).toEqual({
      parkedOnBudget: 0,
      queuedFlushes: 0,
      writerSlotsInUse: 0,
    });
  });

  it("counts callers parked on the weighted memory budget", async () => {
    const worker = createSerialFlushWorker((task: () => Promise<null>) => task(), {
      budget: BUDGET,
      capacity: CAPACITY,
      writerConcurrency: WRITER_CONCURRENCY,
    });

    const held = await worker.reserve(HALF_BUDGET_WEIGHT);
    const firstParked = worker.reserve(HALF_BUDGET_WEIGHT);
    const secondParked = worker.reserve(HALF_BUDGET_WEIGHT);
    await settle();

    expect(worker.depth().parkedOnBudget).toBe(2);

    held.release();
    const first = await firstParked;
    expect(worker.depth().parkedOnBudget).toBe(1);

    first.release();
    const second = await secondParked;
    second.release();
    await worker.close();

    expect(worker.depth().parkedOnBudget).toBe(0);
  });
});
