import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSerialFlushWorker } from "../../../src/core/utils/serial-flush-worker";

// A generous client-side bound: any sane flush deadline is far below ten minutes.
const GENEROUS_DEADLINE_MS = 600_000;

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

describe("createSerialFlushWorker run deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects a wedged run at the bound and resumes the pump only once it settles", async () => {
    let releaseWedge: (() => void) | null = null;
    let wedgedCalls = 0;
    const worker = createSerialFlushWorker((item: number): Promise<number> => {
      if (item === 1) {
        // A half-open connection: the flush stays pending until externally settled.
        return new Promise<number>((resolve) => {
          wedgedCalls += 1;
          releaseWedge = (): void => {
            resolve(item * 10);
          };
        });
      }
      return Promise.resolve(item * 10);
    });

    const wedged = probe(worker.submit(1));
    const follower = worker.submit(2);
    const followerProbe = probe(follower);

    await vi.advanceTimersByTimeAsync(GENEROUS_DEADLINE_MS);

    expect(wedgedCalls).toBe(1);
    // The wedged item must be rejected by the deadline, not left pending forever.
    expect(wedged.status).toBe("rejected");
    /*
     * But the pump must NOT move on while the abandoned run is still live: it
     * still holds its payload and the single flushDatabase connection, so the
     * next family's flush waits for it to actually settle.
     */
    expect(followerProbe.status).toBe("pending");

    // Once the abandoned run finally settles, the pump resumes serially.
    expect(releaseWedge).not.toBeNull();
    const settle = releaseWedge as unknown as () => void;
    settle();
    await vi.advanceTimersByTimeAsync(0);
    await expect(follower).resolves.toBe(20);
  });
});
