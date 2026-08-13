import { describe, expect, it } from "vitest";
import { createDestinationAttemptWideEventFields } from "../src/sync-user";

const EXPECTED_FIELDS = [
  "database.pool.in_flight",
  "database.queries.count",
  "database.queries.duration_ms",
  "database.queries.failed_count",
  "database.queries.queued_count",
  "sync.attempt.duration_ms",
  "sync.phase.destination_lookup.duration_ms",
  "sync.phase.lock_acquire.duration_ms",
  "sync.phase.provider_resolve.duration_ms",
  "sync.phase.source_authority.duration_ms",
] as const;

const burnWallTime = (durationMs: number): void => {
  const busyUntil = performance.now() + durationMs;
  let now = performance.now();
  while (now < busyUntil) {
    now = performance.now();
  }
};

const makeWindow = (overrides: Partial<{
  failedQueryCount: number;
  inFlight: number;
  queryCount: number;
  queryDurationMs: number;
  queuedQueryCount: number;
}> = {}) => () => ({
  failedQueryCount: overrides.failedQueryCount ?? 0,
  inFlight: overrides.inFlight ?? 0,
  queryCount: overrides.queryCount ?? 0,
  queryDurationMs: overrides.queryDurationMs ?? 0,
  queuedQueryCount: overrides.queuedQueryCount ?? 0,
});

const makeTimings = (overrides: Partial<{
  attemptStartedAt: number;
  destinationLookupDurationMs: number;
  lockAcquireDurationMs: number;
  providerResolveDurationMs: number;
  readPoolWindow: ReturnType<typeof makeWindow>;
  sourceAuthorityDurationMs: number;
}> = {}) => ({
  attemptStartedAt: overrides.attemptStartedAt ?? performance.now(),
  destinationLookupDurationMs: overrides.destinationLookupDurationMs ?? 0,
  lockAcquireDurationMs: overrides.lockAcquireDurationMs ?? 0,
  providerResolveDurationMs: overrides.providerResolveDurationMs ?? 0,
  readPoolWindow: overrides.readPoolWindow ?? makeWindow(),
  sourceAuthorityDurationMs: overrides.sourceAuthorityDurationMs ?? 0,
});

describe("createDestinationAttemptWideEventFields", () => {
  it("emits exactly the expected low-cardinality numeric field set", () => {
    const fields = createDestinationAttemptWideEventFields(makeTimings());

    expect(Object.keys(fields).toSorted()).toEqual([...EXPECTED_FIELDS].toSorted());
    for (const field of EXPECTED_FIELDS) {
      expect(typeof fields[field], `${field} is a number`).toBe("number");
      expect(Number.isFinite(fields[field]), `${field} is finite`).toBe(true);
      expect(fields[field]).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the field set identical whatever the pool window reports", () => {
    const keySets = [
      makeWindow(),
      makeWindow({ failedQueryCount: 3, queryCount: 12, queryDurationMs: 41.5 }),
      makeWindow({ inFlight: 11, queuedQueryCount: 4 }),
    ].map((readPoolWindow) =>
      Object.keys(createDestinationAttemptWideEventFields(makeTimings({ readPoolWindow })))
        .toSorted()
        .join("|"));

    expect(new Set(keySets).size).toBe(1);
  });

  it("carries the pool window sample through untouched", () => {
    const fields = createDestinationAttemptWideEventFields(makeTimings({
      readPoolWindow: makeWindow({
        failedQueryCount: 2,
        inFlight: 7,
        queryCount: 19,
        queryDurationMs: 123.45,
        queuedQueryCount: 5,
      }),
    }));

    expect(fields["database.pool.in_flight"]).toBe(7);
    expect(fields["database.queries.count"]).toBe(19);
    expect(fields["database.queries.duration_ms"]).toBe(123.45);
    expect(fields["database.queries.failed_count"]).toBe(2);
    expect(fields["database.queries.queued_count"]).toBe(5);
  });

  it("reports an attempt total no smaller than the phases it names", () => {
    const attemptStartedAt = performance.now();
    const timings = makeTimings({
      attemptStartedAt,
      destinationLookupDurationMs: 1.5,
      lockAcquireDurationMs: 2.5,
      providerResolveDurationMs: 3,
      sourceAuthorityDurationMs: 4,
    });
    burnWallTime(20);

    const fields = createDestinationAttemptWideEventFields(timings);
    const namedTotal = timings.destinationLookupDurationMs
      + timings.lockAcquireDurationMs
      + timings.providerResolveDurationMs
      + timings.sourceAuthorityDurationMs;

    expect(fields["sync.attempt.duration_ms"]).toBeGreaterThanOrEqual(namedTotal);
  });

  it("does not mutate the timings it is given and grows monotonically when re-read", () => {
    const readPoolWindow = makeWindow({ queryCount: 4 });
    const timings = makeTimings({ lockAcquireDurationMs: 9, readPoolWindow });
    const snapshot = { ...timings };

    const totals: number[] = [];
    for (let round = 0; round < 4; round += 1) {
      const fields = createDestinationAttemptWideEventFields(timings);
      expect(fields["sync.phase.lock_acquire.duration_ms"]).toBe(9);
      expect(fields["database.queries.count"]).toBe(4);
      totals.push(fields["sync.attempt.duration_ms"] as number);
    }

    expect(timings).toEqual(snapshot);
    for (let index = 1; index < totals.length; index += 1) {
      expect(totals[index]).toBeGreaterThanOrEqual(totals[index - 1] as number);
    }
  });

  it("rounds durations to at most two decimal places", () => {
    const fields = createDestinationAttemptWideEventFields(makeTimings({
      attemptStartedAt: performance.now() - 12.345_678_9,
    }));
    const total = fields["sync.attempt.duration_ms"] as number;

    expect(Math.round(total * 100)).toBe(total * 100);
  });
});
