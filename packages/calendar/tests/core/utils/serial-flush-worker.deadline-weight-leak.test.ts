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

describe("createSerialFlushWorker deadline expiry vs reserved weight", () => {
  it("keeps a timed-out run's weight held and the pump blocked until the run settles", async () => {
    let releaseWedge: (() => void) | null = null;
    let activeRuns = 0;
    let maxConcurrentRuns = 0;
    const worker = createSerialFlushWorker(
      async (item: FlushItem): Promise<string> => {
        activeRuns += 1;
        maxConcurrentRuns = Math.max(maxConcurrentRuns, activeRuns);
        try {
          if (item.id === "wedge") {
            // A half-open flushDatabase write: holds its transaction, never settles on its own.
            await new Promise<void>((resolve) => {
              releaseWedge = resolve;
            });
          }
          return item.id;
        } finally {
          activeRuns -= 1;
        }
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
     * The abandoned run is still executing: its payload and its single
     * flushDatabase connection are both still live. A full-budget reservation
     * for B must therefore stay parked until A's run actually settles.
     */
    let grantedB: FlushReservation<FlushItem, string> | null = null;
    const reserveB = worker.reserve(BUDGET).then((reservation) => {
      grantedB = reservation;
      return reservation;
    });
    await sleep(SETTLE_WAIT_MS);
    expect(grantedB).toBeNull();

    /*
     * And the serial worker must never run two flushes concurrently: if B had
     * been admitted and submitted, its run would overlap A's abandoned run.
     */
    expect(maxConcurrentRuns).toBe(1);

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
