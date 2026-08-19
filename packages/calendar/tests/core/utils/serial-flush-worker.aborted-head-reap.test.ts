import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "../../../src/core/utils/serial-flush-worker";

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

const settle = async (): Promise<void> => {
  for (let tick = 0; tick < 10; tick += 1) {
    await Promise.resolve();
  }
};

interface FlushReservation {
  release(): void;
  submit(item: number): Promise<number>;
}

interface WeightedWorker {
  close(): Promise<void>;
  reserve(weight: number, signal?: AbortSignal): Promise<FlushReservation>;
  submit(item: number, signal?: AbortSignal): Promise<number>;
}

const createWeightedWorker = (
  run: (item: number) => Promise<number>,
  budget: number,
): WeightedWorker =>
  createSerialFlushWorker(run, { budget } as never) as unknown as WeightedWorker;

const neverRun = (item: number): Promise<number> => Promise.resolve(item);

const BUDGET = 64;
const PINNED_WEIGHT = 32;
const WEIGHT_TOO_LARGE_TO_FIT_BESIDE_PINNED = 40;
const WEIGHT_THAT_FITS_BESIDE_PINNED = 16;

describe("aborted parked weight waiter is reaped immediately", () => {
  it("admits a fitting reservation after the parked head aborts, without waiting for a release", async () => {
    const worker = createWeightedWorker(neverRun, BUDGET);

    await worker.reserve(PINNED_WEIGHT);

    const controller = new AbortController();
    const parked = probe(
      worker.reserve(WEIGHT_TOO_LARGE_TO_FIT_BESIDE_PINNED, controller.signal),
    );
    await settle();
    expect(parked.status).toBe("pending");

    controller.abort(new Error("caller gave up"));
    await settle();
    expect(parked.status).toBe("rejected");

    const fitting = probe(worker.reserve(WEIGHT_THAT_FITS_BESIDE_PINNED));
    await settle();
    expect(fitting.status).toBe("resolved");
  });
});
