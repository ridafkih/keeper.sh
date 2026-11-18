import { describe, expect, it } from "vitest";
import { createJobFlow, probeQueue } from "../src/queue-progress";
import type { QueueProbeOptions } from "../src/queue-progress";

const STALL_AFTER_MS = 600_000;

interface Deferred {
  promise: Promise<null>;
  reject: (error: Error) => void;
  resolve: () => void;
}

const defer = (): Deferred => {
  const { promise, reject, resolve } = Promise.withResolvers<null>();
  return { promise, reject, resolve: () => resolve(null) };
};

const createClock = (): { advance: (deltaMs: number) => void; now: () => number } => {
  const clock = { at: 1_000_000 };
  return {
    advance: (deltaMs) => {
      clock.at += deltaMs;
    },
    now: () => clock.at,
  };
};

const probe = async (overrides: Partial<QueueProbeOptions>): Promise<{ beats: number; progressed: boolean }> => {
  let beats = 0;
  const progressed = await probeQueue({
    isRunning: () => true,
    isStalled: () => false,
    onProgress: () => {
      beats += 1;
    },
    ping: () => Promise.resolve("PONG"),
    pingTimeoutMs: 20,
    ...overrides,
  });
  return { beats, progressed };
};

describe("createJobFlow", () => {
  it("is not stalled while idle, however long nothing happens", () => {
    const clock = createClock();
    const flow = createJobFlow({ now: clock.now, stallAfterMs: STALL_AFTER_MS });

    clock.advance(24 * 60 * 60 * 1000);

    expect(flow.isStalled()).toBe(false);
  });

  it("is not stalled while a job runs within the allowance", () => {
    const clock = createClock();
    const flow = createJobFlow({ now: clock.now, stallAfterMs: STALL_AFTER_MS });
    const job = defer();
    flow.track(() => job.promise);

    clock.advance(STALL_AFTER_MS);

    expect(flow.isStalled()).toBe(false);
    job.resolve();
  });

  it("stalls when a job is in flight and nothing has started or finished past the allowance", () => {
    const clock = createClock();
    const flow = createJobFlow({ now: clock.now, stallAfterMs: STALL_AFTER_MS });
    const job = defer();
    flow.track(() => job.promise);

    clock.advance(STALL_AFTER_MS + 1);

    expect(flow.isStalled()).toBe(true);
    job.resolve();
  });

  it("stays clear while other jobs keep starting and finishing around a long one", async () => {
    const clock = createClock();
    const flow = createJobFlow({ now: clock.now, stallAfterMs: STALL_AFTER_MS });
    const long = defer();
    flow.track(() => long.promise);

    for (let round = 0; round < 5; round += 1) {
      clock.advance(STALL_AFTER_MS - 1);
      await flow.track(() => Promise.resolve());
      expect(flow.isStalled()).toBe(false);
    }
    long.resolve();
  });

  it("clears once the stuck job finishes, and counts a failed job as finished", async () => {
    const clock = createClock();
    const flow = createJobFlow({ now: clock.now, stallAfterMs: STALL_AFTER_MS });
    const job = defer();
    const tracked = flow.track(() => job.promise);
    clock.advance(STALL_AFTER_MS + 1);
    expect(flow.isStalled()).toBe(true);

    job.reject(new Error("provider gave up"));
    await expect(tracked).rejects.toThrow("provider gave up");

    clock.advance(STALL_AFTER_MS + 1);
    expect(flow.isStalled()).toBe(false);
  });
});

describe("probeQueue", () => {
  it("records progress when the worker is running, jobs are moving and the queue answers", async () => {
    expect(await probe({})).toEqual({ beats: 1, progressed: true });
  });

  it("records nothing when the worker loop is not running", async () => {
    expect(await probe({ isRunning: () => false })).toEqual({ beats: 0, progressed: false });
  });

  it("records nothing while jobs are stalled", async () => {
    expect(await probe({ isStalled: () => true })).toEqual({ beats: 0, progressed: false });
  });

  it("records nothing when the queue rejects the request", async () => {
    const result = await probe({ ping: () => Promise.reject(new Error("connection is closed")) });

    expect(result).toEqual({ beats: 0, progressed: false });
  });

  it("records nothing when the queue never answers", async () => {
    const result = await probe({ ping: () => defer().promise, pingTimeoutMs: 15 });

    expect(result).toEqual({ beats: 0, progressed: false });
  });

  it("records nothing when the worker stopped while the request was in flight", async () => {
    const answer = defer();
    const worker = { running: true };
    const pending = probe({ isRunning: () => worker.running, ping: () => answer.promise });

    worker.running = false;
    answer.resolve();

    expect(await pending).toEqual({ beats: 0, progressed: false });
  });
});
