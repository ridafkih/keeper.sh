import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSerialFlushWorker } from "../../../src/core/utils/serial-flush-worker";

const RUN_MS = 20;
const SETTLE_MS = 5;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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

interface Deferred {
  promise: Promise<number>;
  reject: (reason: Error) => void;
  resolve: (value: number) => void;
}

const createDeferred = (): Deferred => {
  const { promise, reject, resolve } = Promise.withResolvers<number>();
  return { promise, reject, resolve };
};

/*
 * Instrumented run whose completion is held open per item by a deferred, so tests can
 * pin exactly when the worker is allowed to move on to the next item.
 */
const createGatedRun = () => {
  const gates = new Map<number, Deferred>();
  const started: number[] = [];
  const run = (item: number): Promise<number> => {
    started.push(item);
    const gate = createDeferred();
    gates.set(item, gate);
    return gate.promise;
  };
  const open = (item: number): void => {
    gates.get(item)?.resolve(item * 10);
  };
  return { open, run, started };
};

describe("createSerialFlushWorker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never overlaps run invocations even under many concurrent submits", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const worker = createSerialFlushWorker(async (item: number) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(RUN_MS);
      inFlight -= 1;
      return item;
    });

    const submissions = [1, 2, 3, 4, 5].map((item) => worker.submit(item));
    await vi.advanceTimersByTimeAsync(RUN_MS * 6);
    await Promise.all(submissions);

    expect(maxInFlight).toBe(1);
  });

  it("completes submits in first-in-first-out submission order", async () => {
    const completions: number[] = [];
    const worker = createSerialFlushWorker(async (item: number) => {
      await delay(RUN_MS);
      return item;
    });

    const submissions = [1, 2, 3, 4, 5].map((item) =>
      worker.submit(item).then((result) => {
        completions.push(result);
        return result;
      }),
    );
    await vi.advanceTimersByTimeAsync(RUN_MS * 6);
    await Promise.all(submissions);

    expect(completions).toEqual([1, 2, 3, 4, 5]);
  });

  it("holds the submit past capacity until a slot frees, then proceeds", async () => {
    const gated = createGatedRun();
    const worker = createSerialFlushWorker(gated.run, { capacity: 2 });

    // Item 1 is picked up by the worker; items 2 and 3 fill the queue to capacity.
    const first = worker.submit(1);
    const second = worker.submit(2);
    const third = worker.submit(3);
    // Item 4 finds the queue full, so its enqueue must wait on backpressure.
    const fourth = worker.submit(4);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(gated.started).toEqual([1]);

    // Finishing item 1 frees a slot: item 2 starts and item 4 may now enqueue.
    gated.open(1);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(gated.started).toEqual([1, 2]);

    gated.open(2);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(gated.started).toEqual([1, 2, 3]);

    gated.open(3);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(gated.started).toEqual([1, 2, 3, 4]);

    gated.open(4);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await expect(first).resolves.toBe(10);
    await expect(second).resolves.toBe(20);
    await expect(third).resolves.toBe(30);
    await expect(fourth).resolves.toBe(40);
  });

  it("routes each result to its own submit and keeps processing after a failing run", async () => {
    const worker = createSerialFlushWorker(async (item: number) => {
      await delay(RUN_MS);
      if (item === 2) {
        throw new Error("flush failed for item 2");
      }
      return item * 10;
    });

    const first = worker.submit(1);
    const second = worker.submit(2);
    const secondProbe = probe(second);
    const third = worker.submit(3);
    await vi.advanceTimersByTimeAsync(RUN_MS * 4);

    await expect(first).resolves.toBe(10);
    expect(secondProbe.status).toBe("rejected");
    await expect(second).rejects.toThrow("flush failed for item 2");
    await expect(third).resolves.toBe(30);
  });

  it("rejects a backpressure-blocked submit with the abort reason and never runs its item", async () => {
    const gated = createGatedRun();
    const worker = createSerialFlushWorker(gated.run, { capacity: 1 });

    // Item 1 occupies the worker; item 2 fills the single queue slot.
    const first = worker.submit(1);
    const second = worker.submit(2);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    const controller = new AbortController();
    const blocked = worker.submit(3, controller.signal);
    const blockedProbe = probe(blocked);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(blockedProbe.status).toBe("pending");

    controller.abort(new Error("caller gave up waiting"));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(blockedProbe.status).toBe("rejected");
    await expect(blocked).rejects.toThrow("caller gave up waiting");

    // The worker keeps going and the aborted item never reaches run.
    gated.open(1);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    gated.open(2);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await expect(first).resolves.toBe(10);
    await expect(second).resolves.toBe(20);
    expect(gated.started).not.toContain(3);
  });

  it("drains already-queued items on close, then rejects later submits", async () => {
    const completions: number[] = [];
    const worker = createSerialFlushWorker(async (item: number) => {
      await delay(RUN_MS);
      completions.push(item);
      return item;
    });

    const submissions = [1, 2, 3].map((item) => worker.submit(item));
    const closed = worker.close();
    const closedProbe = probe(closed);

    // Only the first item has finished, so close must still be draining.
    await vi.advanceTimersByTimeAsync(RUN_MS + SETTLE_MS);
    expect(completions).toEqual([1]);
    expect(closedProbe.status).toBe("pending");

    await vi.advanceTimersByTimeAsync(RUN_MS * 3);
    await Promise.all(submissions);
    expect(completions).toEqual([1, 2, 3]);
    expect(closedProbe.status).toBe("resolved");

    const late = worker.submit(4);
    const lateProbe = probe(late);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(lateProbe.status).toBe("rejected");
    await expect(late).rejects.toThrow();
    expect(completions).toEqual([1, 2, 3]);
  });
});
