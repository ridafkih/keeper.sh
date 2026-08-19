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

/*
 * The local reservation shape mirrors the exported contract; runtime calls go
 * through it as in the sibling weighted tests.
 */
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

describe("aborted parked weight waiter is reaped immediately", () => {
  it("admits a fitting reservation after the parked head aborts, without waiting for a release", async () => {
    const worker = createWeightedWorker(neverRun, 64);

    // Holder pins 32 of 64 and never releases.
    await worker.reserve(32);

    // A 40-weight reservation cannot fit (32 + 40 > 64), so it parks FIFO.
    const controller = new AbortController();
    const parked = probe(worker.reserve(40, controller.signal));
    await settle();
    expect(parked.status).toBe("pending");

    // The parked waiter aborts: it rejected and must no longer block the line.
    controller.abort(new Error("caller gave up"));
    await settle();
    expect(parked.status).toBe("rejected");

    /*
     * A fresh 16-weight reservation fits right now (32 + 16 <= 64). The
     * comment at grantWeight promises an aborted waiter is dropped "so it
     * cannot block the line" — so this must be admitted immediately, not
     * parked behind the phantom until some unrelated holder releases.
     */
    const fitting = probe(worker.reserve(16));
    await settle();
    expect(fitting.status).toBe("resolved");
  });
});
