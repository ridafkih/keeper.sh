import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "../../../src/core/utils/serial-flush-worker";
import type { FlushReservation } from "../../../src/core/utils/serial-flush-worker";

/*
 * 64 units stands in for the 64 MiB WEIGHT_BUDGET. While ten 1-unit holds stand,
 * the parked 60-unit head fits neither the budget (70 > 64) nor the aged ceiling
 * (70 > 68), so express admission must pause to drain outstanding weight.
 */
const BUDGET = 64;
const EXPRESS_WEIGHT = 1;
const TINY_HOLD_COUNT = 10;
const HEAD_WEIGHT = 60;
// 12.5x the overtake bound of 16, so any working aging scheme admits the head well within it.
const CHURN_CYCLES = 200;

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

interface ReservationProbe {
  reservation: FlushReservation<number, number> | null;
  settled: boolean;
}

const probeReserve = (
  promise: Promise<FlushReservation<number, number>>,
): ReservationProbe => {
  const state: ReservationProbe = { reservation: null, settled: false };
  promise
    .then((reservation) => {
      state.settled = true;
      state.reservation = reservation;
      return null;
    })
    .catch(() => {
      state.settled = true;
    });
  return state;
};

describe("express churn starving a large parked head", () => {
  it("admits a parked large-calendar reservation despite sustained tiny express churn", async () => {
    const worker = createSerialFlushWorker<number, number>(
      (item) => Promise.resolve(item),
      { budget: BUDGET },
    );

    let tinyHolds: FlushReservation<number, number>[] = await Promise.all(
      Array.from({ length: TINY_HOLD_COUNT }, () =>
        worker.reserve(EXPRESS_WEIGHT),
      ),
    );

    const headProbe = probeReserve(worker.reserve(HEAD_WEIGHT));
    await flushMicrotasks();
    expect(headProbe.settled).toBe(false);

    // Awaiting replacements would hang once a correct implementation parks express traffic.
    let cycle = 0;
    const parkedReplacements: ReservationProbe[] = [];
    while (cycle < CHURN_CYCLES && !headProbe.settled) {
      const oldest = tinyHolds.shift();
      if (oldest) {
        oldest.release();
      }
      const replacement = probeReserve(worker.reserve(EXPRESS_WEIGHT));
      await flushMicrotasks();
      if (replacement.settled && replacement.reservation) {
        tinyHolds.push(replacement.reservation);
      } else {
        parkedReplacements.push(replacement);
      }
      cycle += 1;
    }

    expect(headProbe.settled).toBe(true);

    if (headProbe.reservation) {
      headProbe.reservation.release();
    }
    for (const hold of tinyHolds) {
      hold.release();
    }
    for (const parked of parkedReplacements) {
      await flushMicrotasks();
      if (parked.reservation) {
        parked.reservation.release();
      }
    }
    tinyHolds = [];
    await worker.close();
  });
});
