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

    const reservationA = await worker.reserve(BUDGET);
    const submitA = reservationA.submit({
      deadlineAt: Date.now() + SHORT_DEADLINE_MS,
      id: "wedge",
    });
    await expect(submitA).rejects.toThrow(/deadline/);

    // The abandoned run still holds its payload and the single flushDatabase connection.
    let grantedB: FlushReservation<FlushItem, string> | null = null;
    const reserveB = worker.reserve(BUDGET).then((reservation) => {
      grantedB = reservation;
      return reservation;
    });
    await sleep(SETTLE_WAIT_MS);
    expect(grantedB).toBeNull();

    expect(maxConcurrentRuns).toBe(1);

    if (releaseWedge !== null) {
      const settle = releaseWedge as () => void;
      settle();
    }
    const reservationB = await reserveB;
    reservationB.release();
    await worker.close();
  });
});
