import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSerialFlushWorker } from "../../../src/core/utils/serial-flush-worker";

const SETTLE_MS = 5;

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
 * pin exactly when a reservation's weight is auto-freed by its run settling.
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
  const fail = (item: number, reason: Error): void => {
    gates.get(item)?.reject(reason);
  };
  return { fail, open, run, started };
};

/*
 * The weighted API does not exist yet, so the exported type has no reserve member.
 * This local shape states the contract under test; the runtime calls go through it.
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

describe("createSerialFlushWorker weighted reservation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("grants concurrent reservations within budget and parks the reserve that would exceed it", async () => {
    const gated = createGatedRun();
    const worker = createWeightedWorker(gated.run, 10);

    // Two 4-weight reservations fit inside a budget of 10.
    const firstReservation = await worker.reserve(4);
    const secondReservation = await worker.reserve(4);

    // A third 4-weight reserve would take outstanding weight to 12 > 10, so it parks.
    const third = worker.reserve(4);
    const thirdProbe = probe(third);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(thirdProbe.status).toBe("pending");

    // Releasing one 4-weight hold drops outstanding weight to 4, admitting the third.
    firstReservation.release();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(thirdProbe.status).toBe("resolved");

    secondReservation.release();
    const granted = await third;
    granted.release();
  });

  it("clamps a reserve heavier than the whole budget and grants it when otherwise idle", async () => {
    const gated = createGatedRun();
    const worker = createWeightedWorker(gated.run, 10);

    // A 3,000-event ICS feed can weigh more than the entire budget; it must not deadlock.
    const whale = worker.reserve(25);
    const whaleProbe = probe(whale);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(whaleProbe.status).toBe("resolved");

    // The clamped whale holds the full budget, so any further reserve parks behind it.
    const whaleReservation = await whale;
    const small = worker.reserve(1);
    const smallProbe = probe(small);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(smallProbe.status).toBe("pending");

    whaleReservation.release();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(smallProbe.status).toBe("resolved");
    const smallReservation = await small;
    smallReservation.release();
  });

  it("frees weight via explicit release when nothing was flushed", async () => {
    const gated = createGatedRun();
    const worker = createWeightedWorker(gated.run, 5);

    const holder = await worker.reserve(5);
    const waiting = worker.reserve(3);
    const waitingProbe = probe(waiting);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(waitingProbe.status).toBe("pending");

    // The fetch failed upstream: release() alone must return the weight.
    holder.release();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(waitingProbe.status).toBe("resolved");
    const waitingReservation = await waiting;
    waitingReservation.release();
  });

  it("frees weight automatically when the submitted item's run resolves", async () => {
    const gated = createGatedRun();
    const worker = createWeightedWorker(gated.run, 5);

    const holder = await worker.reserve(5);
    const flushed = holder.submit(1);
    const waiting = worker.reserve(2);
    const waitingProbe = probe(waiting);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(gated.started).toEqual([1]);
    expect(waitingProbe.status).toBe("pending");

    gated.open(1);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await expect(flushed).resolves.toBe(10);
    expect(waitingProbe.status).toBe("resolved");
    const waitingReservation = await waiting;
    waitingReservation.release();
  });

  it("frees weight automatically when the submitted item's run rejects", async () => {
    const gated = createGatedRun();
    const worker = createWeightedWorker(gated.run, 5);

    const holder = await worker.reserve(5);
    const flushed = holder.submit(1);
    const flushedProbe = probe(flushed);
    const waiting = worker.reserve(2);
    const waitingProbe = probe(waiting);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(waitingProbe.status).toBe("pending");

    // A failing flush still ends the reservation; its weight must not leak.
    gated.fail(1, new Error("flush transaction failed"));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(flushedProbe.status).toBe("rejected");
    await expect(flushed).rejects.toThrow("flush transaction failed");
    expect(waitingProbe.status).toBe("resolved");
    const waitingReservation = await waiting;
    waitingReservation.release();
  });

  it("does not free weight twice on double release or release after a settled submit", async () => {
    const gated = createGatedRun();
    const worker = createWeightedWorker(gated.run, 5);

    // Double release: the second call must be a no-op, not a second credit of 5.
    const doubled = await worker.reserve(5);
    doubled.release();
    doubled.release();

    // Release after the submitted run already settled (auto-free): also a no-op.
    const settled = await worker.reserve(5);
    const flushed = settled.submit(1);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    gated.open(1);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await expect(flushed).resolves.toBe(10);
    settled.release();

    // Over-freeing would drive outstanding accounting negative, in which case
    // BOTH full-budget reservations below would be granted at once.
    const firstFull = await worker.reserve(5);
    const secondFull = worker.reserve(5);
    const secondFullProbe = probe(secondFull);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(secondFullProbe.status).toBe("pending");

    firstFull.release();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(secondFullProbe.status).toBe("resolved");
    const secondFullReservation = await secondFull;
    secondFullReservation.release();
  });

  it("rejects a waiting reserve with the abort reason and frees nothing", async () => {
    const gated = createGatedRun();
    const worker = createWeightedWorker(gated.run, 5);

    const holder = await worker.reserve(5);
    const controller = new AbortController();
    const blocked = worker.reserve(3, controller.signal);
    const blockedProbe = probe(blocked);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(blockedProbe.status).toBe("pending");

    controller.abort(new Error("collector gave up waiting"));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(blockedProbe.status).toBe("rejected");
    await expect(blocked).rejects.toThrow("collector gave up waiting");

    // The aborted waiter acquired nothing, so once the holder releases exactly
    // ONE full budget is available again: a 5-weight reserve fits, one more unit does not.
    holder.release();
    const exact = worker.reserve(5);
    const exactProbe = probe(exact);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(exactProbe.status).toBe("resolved");

    const overflow = worker.reserve(1);
    const overflowProbe = probe(overflow);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(overflowProbe.status).toBe("pending");

    const exactReservation = await exact;
    exactReservation.release();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(overflowProbe.status).toBe("resolved");
    const overflowReservation = await overflow;
    overflowReservation.release();
  });

  it("keeps unweighted submit and capacity behavior when budget is not set", async () => {
    const gated = createGatedRun();
    const worker = createSerialFlushWorker(gated.run, { capacity: 1 });

    // Item 1 occupies the worker; item 2 fills the single queue slot; item 3 parks.
    const first = worker.submit(1);
    const second = worker.submit(2);
    const third = worker.submit(3);
    const thirdProbe = probe(third);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(gated.started).toEqual([1]);
    expect(thirdProbe.status).toBe("pending");

    gated.open(1);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    gated.open(2);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    gated.open(3);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await expect(first).resolves.toBe(10);
    await expect(second).resolves.toBe(20);
    await expect(third).resolves.toBe(30);
  });
});
