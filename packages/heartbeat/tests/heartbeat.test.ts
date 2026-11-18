import { describe, expect, it } from "vitest";
import { createHeartbeat } from "../src";
import type { HeartbeatSnapshot } from "../src";

interface Harness {
  advance: (deltaMs: number) => void;
  errors: unknown[];
  failWrites: (failing: boolean) => void;
  heartbeat: ReturnType<typeof createHeartbeat>;
  latest: () => HeartbeatSnapshot;
  writes: () => number;
}

const START_AT = 1_000_000;
const STALE_AFTER_MS = 60_000;

const createHarness = (minWriteIntervalMs = 5000): Harness => {
  const clock = { at: START_AT };
  const written: string[] = [];
  const errors: unknown[] = [];
  const disk = { failing: false };
  const heartbeat = createHeartbeat({
    filePath: "/heartbeat.json",
    minWriteIntervalMs,
    now: () => clock.at,
    onWriteError: (error) => {
      errors.push(error);
    },
    write: (_filePath, contents) => {
      if (disk.failing) {
        throw new Error("read-only file system");
      }
      written.push(contents);
    },
  });
  return {
    advance: (deltaMs) => {
      clock.at += deltaMs;
    },
    errors,
    failWrites: (failing) => {
      disk.failing = failing;
    },
    heartbeat,
    latest: () => JSON.parse(written.at(-1) ?? "null"),
    writes: () => written.length,
  };
};

describe("createHeartbeat", () => {
  it("records a start with no pulses", () => {
    const harness = createHarness();

    expect(harness.heartbeat.start()).toBe(true);

    expect(harness.latest()).toEqual({ pulses: {}, writtenAt: START_AT });
  });

  it("writes the first beat of a pulse immediately", () => {
    const harness = createHarness();
    harness.heartbeat.start();
    harness.advance(10);

    harness.heartbeat.beat("lane", STALE_AFTER_MS);

    expect(harness.latest().pulses).toEqual({
      lane: { beatAt: START_AT + 10, staleAfterMs: STALE_AFTER_MS },
    });
  });

  it("holds back writes inside the write interval and persists the latest beat after it", () => {
    const harness = createHarness(5000);
    harness.heartbeat.beat("lane", STALE_AFTER_MS);
    const writesAfterFirstBeat = harness.writes();

    harness.advance(1000);
    harness.heartbeat.beat("lane", STALE_AFTER_MS);
    harness.advance(1000);
    harness.heartbeat.beat("lane", STALE_AFTER_MS);
    expect(harness.writes()).toBe(writesAfterFirstBeat);

    harness.advance(3000);
    harness.heartbeat.beat("lane", STALE_AFTER_MS);

    expect(harness.writes()).toBe(writesAfterFirstBeat + 1);
    expect(harness.latest().pulses.lane?.beatAt).toBe(START_AT + 5000);
  });

  it("never refreshes a pulse that stopped beating while another keeps going", () => {
    const harness = createHarness(5000);
    harness.heartbeat.beat("stuck", STALE_AFTER_MS);

    for (let turn = 0; turn < 20; turn += 1) {
      harness.advance(10_000);
      harness.heartbeat.beat("moving", STALE_AFTER_MS);
    }

    expect(harness.latest().pulses.stuck?.beatAt).toBe(START_AT);
    expect(harness.latest().pulses.moving?.beatAt).toBe(START_AT + 200_000);
  });

  it("writes nothing when nothing beats", () => {
    const harness = createHarness();
    harness.heartbeat.beat("lane", STALE_AFTER_MS);
    const writes = harness.writes();

    harness.advance(3_600_000);

    expect(harness.writes()).toBe(writes);
  });

  it("never throws into the loop that beats, even when reporting a failed write throws", () => {
    const heartbeat = createHeartbeat({
      filePath: "/heartbeat.json",
      onWriteError: () => {
        throw new Error("logger is gone");
      },
      write: () => {
        throw new Error("no space left on device");
      },
    });

    expect(heartbeat.start()).toBe(false);
    expect(() => heartbeat.beat("lane", STALE_AFTER_MS)).not.toThrow();
  });

  it("survives a failing write and reports the failure once per streak", () => {
    const harness = createHarness(0);
    harness.failWrites(true);

    expect(harness.heartbeat.start()).toBe(false);
    harness.heartbeat.beat("lane", STALE_AFTER_MS);
    harness.heartbeat.beat("lane", STALE_AFTER_MS);
    expect(harness.errors).toHaveLength(1);

    harness.failWrites(false);
    harness.advance(1);
    harness.heartbeat.beat("lane", STALE_AFTER_MS);
    expect(harness.latest().pulses.lane?.beatAt).toBe(START_AT + 1);

    harness.failWrites(true);
    harness.heartbeat.beat("lane", STALE_AFTER_MS);
    expect(harness.errors).toHaveLength(2);
  });
});
