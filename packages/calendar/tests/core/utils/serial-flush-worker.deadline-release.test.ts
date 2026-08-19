import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "../../../src/core/utils/serial-flush-worker";
import type { FlushReservation } from "../../../src/core/utils/serial-flush-worker";

// Mirrors the cron wiring: the whole 64MB budget reserved by one cold-start fetch.
const BUDGET = 64;
const SHORT_DEADLINE_MS = 50;
const SETTLE_WAIT_MS = 25;

interface FlushItem {
  deadlineAt?: number;
  id: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe("createSerialFlushWorker deadline expiry vs caller release()", () => {
  it("keeps a timed-out run's weight held even when the caller's finally calls release()", async () => {
    let releaseWedge: (() => void) | null = null;
    const worker = createSerialFlushWorker(
      async (item: FlushItem): Promise<string> => {
        if (item.id === "wedge") {
          // A half-open flushDatabase write: holds its transaction, never settles on its own.
          await new Promise<void>((resolve) => {
            releaseWedge = resolve;
          });
        }
        return item.id;
      },
      { budget: BUDGET },
    );

    // Reservation A takes the full budget, then its run wedges past its deadline.
    const reservationA = await worker.reserve(BUDGET);
    const submitA = reservationA.submit({
      deadlineAt: Date.now() + SHORT_DEADLINE_MS,
      id: "wedge",
    });
    await expect(submitA).rejects.toThrow(/deadline/);

    /*
     * Production sequence (services/cron/src/jobs/ingest-sources.ts): every
     * ingest family wraps its ingestSource call in
     * `try { ... reservation.submit(...) ... } finally { reservation.release(); }`.
     * The deadline rejection above propagates out of the try, so the finally
     * runs release() while the abandoned run is still executing.
     */
    reservationA.release();

    /*
     * Settle-only invariant: the abandoned run is still executing — its
     * payload and its single flushDatabase connection are both still live —
     * so a full-budget reservation for B must stay parked until A's run
     * actually settles, release() or not.
     */
    let grantedB: FlushReservation<FlushItem, string> | null = null;
    const reserveB = worker.reserve(BUDGET).then((reservation) => {
      grantedB = reservation;
      return reservation;
    });
    await sleep(SETTLE_WAIT_MS);
    expect(grantedB).toBeNull();

    // Cleanup: settle the wedged run, then drain whatever the grant produced.
    if (releaseWedge !== null) {
      const settle = releaseWedge as () => void;
      settle();
    }
    const reservationB = await reserveB;
    reservationB.release();
    await worker.close();
  });
});
