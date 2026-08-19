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
          await new Promise<void>((resolve) => {
            releaseWedge = resolve;
          });
        }
        return item.id;
      },
      { budget: BUDGET },
    );

    const reservationA = await worker.reserve(BUDGET);
    const submitA = reservationA.submit({
      deadlineAt: Date.now() + SHORT_DEADLINE_MS,
      id: "wedge",
    });
    await expect(submitA).rejects.toThrow(/deadline/);

    // Production wraps submit in try/finally, so release() runs while the abandoned run executes.
    reservationA.release();

    let grantedB: FlushReservation<FlushItem, string> | null = null;
    const reserveB = worker.reserve(BUDGET).then((reservation) => {
      grantedB = reservation;
      return reservation;
    });
    await sleep(SETTLE_WAIT_MS);
    expect(grantedB).toBeNull();

    if (releaseWedge !== null) {
      const settle = releaseWedge as () => void;
      settle();
    }
    const reservationB = await reserveB;
    reservationB.release();
    await worker.close();
  });
});
