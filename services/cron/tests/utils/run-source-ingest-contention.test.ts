import { buildCalendarBackoffState } from "@keeper.sh/calendar";
import type { CalendarBackoffState } from "@keeper.sh/calendar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSourceIngest } from "../../src/utils/run-source-ingest";
import type { SourceIngestAttempt, SourceIngestDependencies, SourceIngestLease } from "../../src/utils/run-source-ingest";

const CALENDAR_A = "a1e1d2c3-4b5a-4c6d-8e9f-0a1b2c3d4e5f";
const CALENDAR_B = "b2f2e3d4-5c6b-4d7e-9f0a-1b2c3d4e5f60";
const MINUTE_MS = 60_000;
const INITIAL_BACKOFF_MS = 5 * MINUTE_MS;
const MAX_BACKOFF_MS = 6 * 60 * MINUTE_MS;
const START_AT = new Date("2026-08-12T09:00:00.000Z");

interface CalendarRow {
  ingestFailureCount: number;
  ingestLastFailureAt: Date | null;
  ingestNextAttemptAt: Date | null;
}

interface WriteRecord {
  calendarId: string;
  kind: "apply" | "reset" | "skipped";
}

interface Fleet {
  dependencies: SourceIngestDependencies;
  leaseHolders: string[];
  recorded: CalendarBackoffState[];
  releases: number;
  rows: Map<string, CalendarRow>;
  writes: WriteRecord[];
}

interface FleetOptions {
  acquireError?: Error;
  isCurrent?: (calendarId: string) => Promise<boolean>;
}

const freshRow = (): CalendarRow => ({
  ingestFailureCount: 0,
  ingestLastFailureAt: null,
  ingestNextAttemptAt: null,
});

const matchesObserved = (row: CalendarRow, observed: SourceIngestAttempt): boolean =>
  row.ingestFailureCount === observed.failureCount
  && (row.ingestNextAttemptAt?.getTime() ?? null) === (observed.nextAttemptAt?.getTime() ?? null);

const createFleet = (
  rows: Record<string, CalendarRow>,
  options: FleetOptions = {},
): Fleet => {
  const held = new Set<string>();
  const fleet: Fleet = {
    dependencies: {} as SourceIngestDependencies,
    leaseHolders: [],
    recorded: [],
    releases: 0,
    rows: new Map(Object.entries(rows)),
    writes: [],
  };

  const readRow = (calendarId: string): CalendarRow | null =>
    fleet.rows.get(calendarId) ?? null;

  fleet.dependencies = {
    acquireLease: (calendarId): Promise<SourceIngestLease | null> => {
      if (options.acquireError) {
        return Promise.reject(options.acquireError);
      }
      if (held.has(calendarId)) {
        return Promise.resolve(null);
      }
      held.add(calendarId);
      fleet.leaseHolders.push(calendarId);
      return Promise.resolve({
        isCurrent: () => options.isCurrent?.(calendarId) ?? Promise.resolve(true),
        release: () => {
          held.delete(calendarId);
          fleet.releases += 1;
          return Promise.resolve();
        },
      });
    },
    applyBackoff: (calendarId, observedAttempt) => {
      const row = readRow(calendarId);
      if (!row || !matchesObserved(row, observedAttempt)) {
        fleet.writes.push({ calendarId, kind: "skipped" });
        return Promise.resolve(null);
      }
      const state = buildCalendarBackoffState(observedAttempt.failureCount, new Date());
      row.ingestFailureCount = state.failureCount;
      row.ingestLastFailureAt = state.lastFailureAt;
      row.ingestNextAttemptAt = state.nextAttemptAt;
      fleet.writes.push({ calendarId, kind: "apply" });
      return Promise.resolve(state);
    },
    readAttempt: (calendarId) => {
      const row = readRow(calendarId);
      if (!row) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        failureCount: row.ingestFailureCount,
        nextAttemptAt: row.ingestNextAttemptAt,
      });
    },
    recordBackoff: (state) => {
      fleet.recorded.push(state);
    },
    resetBackoff: (calendarId) => {
      const row = readRow(calendarId);
      if (row) {
        row.ingestFailureCount = 0;
        row.ingestLastFailureAt = null;
        row.ingestNextAttemptAt = null;
      }
      fleet.writes.push({ calendarId, kind: "reset" });
      return Promise.resolve();
    },
  };

  return fleet;
};

const liveSignal = (): AbortSignal => new AbortController().signal;

const tick = (
  fleet: Fleet,
  calendarId: string,
  work: () => Promise<unknown>,
): Promise<unknown> =>
  runSourceIngest(fleet.dependencies, calendarId, liveSignal(), work)
    .catch((error: unknown) => error);

const credentialError = (): Error =>
  Object.assign(new Error("Token refresh failed (400): invalid_grant"), {
    oauthReauthRequired: true,
  });

const unstartedGate = (): never => {
  throw new Error("The gated ingest was never started");
};

const ingestOutcome = (shouldFail: boolean): (() => Promise<string>) => {
  if (shouldFail) {
    return () => Promise.reject(credentialError());
  }
  return () => Promise.resolve("ingested");
};

describe("runSourceIngest under contention", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the work once when two scheduler ticks overlap on the same calendar", async () => {
    const fleet = createFleet({ [CALENDAR_A]: freshRow() });
    const started: number[] = [];
    let resolveWork: (value: string) => void = unstartedGate;
    const gated = (): Promise<string> => {
      started.push(started.length);
      return new Promise<string>((resolve) => {
        resolveWork = resolve;
      });
    };

    const first = tick(fleet, CALENDAR_A, gated);
    await Promise.resolve();
    const second = tick(fleet, CALENDAR_A, gated);
    await Promise.resolve();

    expect(started).toHaveLength(1);
    expect(await second).toBeNull();

    resolveWork("ingested");
    expect(await first).toBe("ingested");
    expect(fleet.releases).toBe(1);
    expect(fleet.writes).toEqual([]);
  });

  it("arms the backoff once when two overlapping ticks hit a dead credential", async () => {
    const fleet = createFleet({ [CALENDAR_A]: freshRow() });
    const failure = credentialError();
    let rejectWork: (error: Error) => void = unstartedGate;
    const gated = (): Promise<never> =>
      new Promise<never>((_resolve, reject) => {
        rejectWork = reject;
      });

    const first = tick(fleet, CALENDAR_A, gated);
    await Promise.resolve();
    const second = tick(fleet, CALENDAR_A, () => Promise.reject(failure));
    await Promise.resolve();

    expect(await second).toBeNull();
    rejectWork(failure);
    expect(await first).toBe(failure);

    expect(fleet.writes).toEqual([{ calendarId: CALENDAR_A, kind: "apply" }]);
    expect(fleet.rows.get(CALENDAR_A)?.ingestFailureCount).toBe(1);
  });

  it("writes nothing anywhere when the lock store is unreachable", async () => {
    const acquireError = new Error("Redis connection refused");
    const fleet = createFleet({ [CALENDAR_A]: freshRow() }, { acquireError });

    expect(await tick(fleet, CALENDAR_A, () => Promise.reject(credentialError())))
      .toBe(acquireError);
    expect(fleet.writes).toEqual([]);
    expect(fleet.rows.get(CALENDAR_A)).toEqual(freshRow());
    expect(fleet.releases).toBe(0);
  });

  it("keeps a failing calendar from touching a healthy sibling's backoff", async () => {
    const fleet = createFleet({
      [CALENDAR_A]: freshRow(),
      [CALENDAR_B]: freshRow(),
    });

    const failing = tick(fleet, CALENDAR_A, () => Promise.reject(credentialError()));
    const healthy = tick(fleet, CALENDAR_B, () => Promise.resolve("ingested"));
    await Promise.all([failing, healthy]);

    expect(fleet.rows.get(CALENDAR_B)).toEqual(freshRow());
    expect(fleet.rows.get(CALENDAR_A)?.ingestFailureCount).toBe(1);
    expect(fleet.writes).toEqual([{ calendarId: CALENDAR_A, kind: "apply" }]);
  });

  it("does not compound the delay for a source that fails every other tick", async () => {
    const fleet = createFleet({ [CALENDAR_A]: freshRow() });
    const counts: number[] = [];
    const delays: number[] = [];

    for (let index = 0; index < 40; index += 1) {
      const before = Date.now();
      const shouldFail = index % 2 === 0;
      await tick(fleet, CALENDAR_A, ingestOutcome(shouldFail));
      const row = fleet.rows.get(CALENDAR_A) as CalendarRow;
      counts.push(row.ingestFailureCount);
      if (row.ingestNextAttemptAt) {
        delays.push(row.ingestNextAttemptAt.getTime() - before);
        vi.setSystemTime(row.ingestNextAttemptAt);
      } else {
        vi.setSystemTime(new Date(before + MINUTE_MS));
      }
    }

    expect(Math.max(...counts)).toBe(1);
    expect(new Set(delays)).toEqual(new Set([INITIAL_BACKOFF_MS]));
    expect(fleet.rows.get(CALENDAR_A)).toEqual(freshRow());
  });

  it("keeps the stored failure count equal to the number of backoff writes", async () => {
    const fleet = createFleet({ [CALENDAR_A]: freshRow() });

    for (let index = 0; index < 30; index += 1) {
      await tick(fleet, CALENDAR_A, () => Promise.reject(credentialError()));
      const row = fleet.rows.get(CALENDAR_A) as CalendarRow;
      vi.setSystemTime(row.ingestNextAttemptAt as Date);
    }

    const applied = fleet.writes.filter(({ kind }) => kind === "apply");
    expect(applied).toHaveLength(30);
    expect(fleet.rows.get(CALENDAR_A)?.ingestFailureCount).toBe(30);
    expect(fleet.recorded.map(({ failureCount }) => failureCount))
      .toEqual(Array.from({ length: 30 }, (_value, index) => index + 1));
    const last = fleet.recorded.at(-1) as CalendarBackoffState;
    expect((last.nextAttemptAt as Date).getTime() - (last.lastFailureAt as Date).getTime())
      .toBe(MAX_BACKOFF_MS);
  });

  it("measures the backoff in absolute time across a daylight-saving transition", async () => {
    const springForward = new Date("2026-03-08T06:58:00.000Z");
    vi.setSystemTime(springForward);
    const fleet = createFleet({ [CALENDAR_A]: freshRow() });

    await tick(fleet, CALENDAR_A, () => Promise.reject(credentialError()));

    const row = fleet.rows.get(CALENDAR_A) as CalendarRow;
    expect(row.ingestNextAttemptAt?.getTime())
      .toBe(springForward.getTime() + INITIAL_BACKOFF_MS);

    vi.setSystemTime(new Date(springForward.getTime() + INITIAL_BACKOFF_MS - 1));
    expect(await tick(fleet, CALENDAR_A, () => Promise.reject(new Error("must not run"))))
      .toBeNull();

    vi.setSystemTime(row.ingestNextAttemptAt as Date);
    expect(await tick(fleet, CALENDAR_A, () => Promise.resolve("ingested"))).toBe("ingested");
    expect(fleet.rows.get(CALENDAR_A)).toEqual(freshRow());
  });

  it("clears the streak on a successful run whose lease was superseded", async () => {
    const leaseState = { current: false };
    const fleet = createFleet(
      {
        [CALENDAR_A]: {
          ingestFailureCount: 4,
          ingestLastFailureAt: new Date(START_AT.getTime() - MINUTE_MS),
          ingestNextAttemptAt: new Date(START_AT.getTime() - MINUTE_MS),
        },
      },
      { isCurrent: () => Promise.resolve(leaseState.current) },
    );

    expect(await tick(fleet, CALENDAR_A, () => Promise.resolve("ingested"))).toBe("ingested");
    expect(fleet.rows.get(CALENDAR_A)).toEqual(freshRow());

    for (let index = 0; index < 3; index += 1) {
      expect(await tick(fleet, CALENDAR_A, () => Promise.resolve("ingested"))).toBe("ingested");
      expect(fleet.rows.get(CALENDAR_A)).toEqual(freshRow());
    }

    leaseState.current = true;
    expect(await tick(fleet, CALENDAR_A, () => Promise.resolve("ingested"))).toBe("ingested");
    expect(fleet.rows.get(CALENDAR_A)).toEqual(freshRow());
    expect(fleet.writes).toEqual([{ calendarId: CALENDAR_A, kind: "reset" }]);
  });

  it("skips the backoff when only the failure count moved under the run", async () => {
    const fleet = createFleet({ [CALENDAR_A]: freshRow() });

    const result = await tick(fleet, CALENDAR_A, () => {
      const row = fleet.rows.get(CALENDAR_A) as CalendarRow;
      row.ingestFailureCount = 2;
      return Promise.reject(credentialError());
    });

    expect(result).toBeInstanceOf(Error);
    expect(fleet.writes).toEqual([]);
    expect(fleet.rows.get(CALENDAR_A)?.ingestNextAttemptAt).toBeNull();
  });

  it("does not resurrect a calendar deleted while the ingest was running", async () => {
    const fleet = createFleet({ [CALENDAR_A]: freshRow() });

    const result = await tick(fleet, CALENDAR_A, () => {
      fleet.rows.delete(CALENDAR_A);
      return Promise.reject(credentialError());
    });

    expect(result).toBeInstanceOf(Error);
    expect(fleet.rows.has(CALENDAR_A)).toBe(false);
    expect(fleet.writes).toEqual([]);
  });
});
