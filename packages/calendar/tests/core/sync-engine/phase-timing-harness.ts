import { expect, vi } from "vitest";

const PHASE_FIELDS = [
  "sync.phase.read_state.duration_ms",
  "sync.phase.currency_check.duration_ms",
  "sync.phase.compute_operations.duration_ms",
  "sync.phase.provider_push.duration_ms",
  "sync.phase.provider_delete.duration_ms",
  "sync.phase.checkpoint_flush.duration_ms",
  "sync.phase.mapping_flush.duration_ms",
] as const;

type PhaseField = (typeof PHASE_FIELDS)[number];

const MONOTONIC_ORIGIN_MS = 1000;
const WALL_ORIGIN_MS = Date.parse("2026-03-15T08:00:00.000Z");

const clock = { monotonicMs: MONOTONIC_ORIGIN_MS, wallMs: WALL_ORIGIN_MS };

const elapse = (durationMs: number): void => {
  clock.monotonicMs += durationMs;
  clock.wallMs += durationMs;
};

const stepWallClock = (offsetMs: number): void => {
  clock.wallMs += offsetMs;
};

const installControlledClock = (): void => {
  clock.monotonicMs = MONOTONIC_ORIGIN_MS;
  clock.wallMs = WALL_ORIGIN_MS;
  vi.spyOn(performance, "now").mockImplementation(() => clock.monotonicMs);
  vi.spyOn(Date, "now").mockImplementation(() => clock.wallMs);
};

interface Gate {
  entered: Promise<null>;
  pass: () => Promise<null>;
  release: () => void;
}

const createGate = (): Gate => {
  const entry = Promise.withResolvers<null>();
  const exit = Promise.withResolvers<null>();
  return {
    entered: entry.promise,
    pass: () => {
      entry.resolve(null);
      return exit.promise;
    },
    release: () => {
      exit.resolve(null);
    },
  };
};

interface ExpectedRemainder {
  unattributedMs?: number;
  wallClockStepMs?: number;
}

const expectPhaseDurations = (
  event: Record<string, unknown>,
  expectedPhases: Partial<Record<PhaseField, number>> = {},
  { unattributedMs = 0, wallClockStepMs = 0 }: ExpectedRemainder = {},
): void => {
  let attributedMs = 0;
  for (const field of PHASE_FIELDS) {
    const expectedMs = expectedPhases[field] ?? 0;
    attributedMs += expectedMs;
    expect(event[field], field).toBe(expectedMs);
  }

  const reconcileMs = attributedMs + unattributedMs;
  expect(event["sync.phase.unattributed.duration_ms"]).toBe(unattributedMs);
  expect(event["sync.reconcile.duration_ms"]).toBe(reconcileMs);
  expect(event["duration_ms"]).toBe(reconcileMs + wallClockStepMs);
};

export { PHASE_FIELDS, createGate, elapse, expectPhaseDurations, installControlledClock, stepWallClock };
