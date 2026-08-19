import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "../../../src/core/utils/serial-flush-worker";
import type { FlushReservation } from "../../../src/core/utils/serial-flush-worker";

/*
 * Anti-starvation contract for a LARGE parked head. Proportions mirror
 * production: budget 64 units stands in for the 64 MiB WEIGHT_BUDGET, so
 * budget/64 = 1 is the express threshold (a warm <=1024-event calendar) and
 * 60 units is a large-calendar reservation just under the whale clamp.
 *
 * The aged-admission ceiling is budget + budget/16 = 68. Ten concurrent
 * 1-unit express holds keep outstanding at 10, so the parked 60-unit head
 * needs 70 <= 68 under grantOvertakenHead and 70 <= 64 under grantWeight —
 * both impossible while express churn keeps replacing released holds. The
 * EXPRESS_MAX_OVERTAKES bound must therefore pause express admission (or
 * otherwise drain outstanding weight) so the head is eventually admitted;
 * this test proves it never is.
 */
const BUDGET = 64;
const EXPRESS_WEIGHT = 1;
const TINY_HOLD_COUNT = 10;
const HEAD_WEIGHT = 60;
/*
 * Each cycle releases one tiny hold and immediately reserves a replacement —
 * exactly the sustained tiny traffic the EXPRESS_MAX_OVERTAKES comment claims
 * cannot park a large-calendar reservation past its deadline. 200 cycles is
 * 12.5x the overtake bound of 16, so any working aging scheme has admitted
 * the head long before the loop ends.
 */
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

    // Ten concurrent warm-calendar holds pin 10 of 64 units; 84% of the budget is idle.
    let tinyHolds: FlushReservation<number, number>[] = await Promise.all(
      Array.from({ length: TINY_HOLD_COUNT }, () =>
        worker.reserve(EXPRESS_WEIGHT),
      ),
    );

    // The large-calendar reservation cannot fit (10 + 60 > 64) and parks as FIFO head.
    const headProbe = probeReserve(worker.reserve(HEAD_WEIGHT));
    await flushMicrotasks();
    expect(headProbe.settled).toBe(false);

    /*
     * Sustained tiny churn: release one warm hold, reserve a replacement.
     * Replacement reserves are probed rather than awaited so that a correct
     * implementation which parks express traffic once the overtake bound is
     * reached cannot hang the loop; on such an implementation the releases
     * drain outstanding weight until the head fits and is admitted.
     */
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

    /*
     * Fairness guarantee under test: "sustained tiny traffic cannot park a
     * cold-start or large-calendar reservation past its deadline". On the
     * current code every replacement is express-granted BEFORE the head check,
     * outstanding weight never drops below 10 at any admission check, and
     * 10 + 60 = 70 exceeds both the budget (64) and the aged ceiling (68),
     * so the head is still pending after 200 cycles — 12.5x the bound of 16.
     */
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
