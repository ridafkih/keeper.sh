import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "../../../src/core/utils/serial-flush-worker";

const SETTLE_MS = 25;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

interface SettlementProbe {
  reason: unknown;
  status: "pending" | "rejected" | "resolved";
}

const probe = (promise: Promise<unknown>): SettlementProbe => {
  const state: SettlementProbe = { reason: null, status: "pending" };
  promise
    .then(() => {
      state.status = "resolved";
      return null;
    })
    .catch((error: unknown) => {
      state.reason = error;
      state.status = "rejected";
    });
  return state;
};

describe("serial flush worker queued abort", () => {
  it("rejects a queued submit when its signal aborts, before queue drain", async () => {
    const { promise: gate, resolve: releaseFirst } = Promise.withResolvers<null>();
    const ran: string[] = [];
    const worker = createSerialFlushWorker(async (item: string) => {
      ran.push(item);
      if (item === "first") {
        await gate;
      }
      return item;
    });

    // The first item occupies the pump; the second parks in the queue.
    const first = worker.submit("first");
    const controller = new AbortController();
    const reason = new Error("source deadline hit");
    const second = worker.submit("second", controller.signal);
    const secondProbe = probe(second);

    controller.abort(reason);
    await delay(SETTLE_MS);

    // An aborted queued submit must settle at its deadline, not at queue drain.
    expect(secondProbe.status).toBe("rejected");
    expect(secondProbe.reason).toBe(reason);

    releaseFirst(null);
    await first;
    await delay(SETTLE_MS);

    // The aborted item must never have run.
    expect(ran).toEqual(["first"]);

    await worker.close();
  });
});
