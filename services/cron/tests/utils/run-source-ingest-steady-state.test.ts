import { buildCalendarBackoffState } from "@keeper.sh/calendar";
import type { CalendarBackoffState } from "@keeper.sh/calendar";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAttemptDue, runSourceIngest } from "../../src/utils/run-source-ingest";
import type { SourceIngestAttempt, SourceIngestDependencies } from "../../src/utils/run-source-ingest";

const CALENDAR_ID = "9d4f1a76-2b8c-4e51-97a3-0c6d5e8b3f14";
const MINUTE_MS = 60_000;
const MAX_BACKOFF_MS = 6 * 60 * MINUTE_MS;
const START_AT = new Date("2026-08-12T09:00:00.000Z");

interface CalendarRow {
  ingestFailureCount: number;
  ingestLastFailureAt: Date | null;
  ingestNextAttemptAt: Date | null;
}

interface Calendar {
  dependencies: SourceIngestDependencies;
  recorded: CalendarBackoffState[];
  row: CalendarRow;
  writes: { kind: "apply" | "reset"; row: CalendarRow }[];
}

const rowMatchesObservedAttempt = (
  row: CalendarRow,
  observed: SourceIngestAttempt,
): boolean => row.ingestFailureCount === observed.failureCount
  && (row.ingestNextAttemptAt?.getTime() ?? null) === (observed.nextAttemptAt?.getTime() ?? null);

const createCalendar = (row: CalendarRow): Calendar => {
  const calendar: Calendar = {
    dependencies: {} as SourceIngestDependencies,
    recorded: [],
    row,
    writes: [],
  };

  calendar.dependencies = {
    acquireLease: () => Promise.resolve({
      isCurrent: () => Promise.resolve(true),
      release: () => Promise.resolve(),
    }),
    applyBackoff: (_calendarId, observedAttempt) => {
      if (!rowMatchesObservedAttempt(calendar.row, observedAttempt)) {
        return Promise.resolve(null);
      }
      const state = buildCalendarBackoffState(observedAttempt.failureCount, new Date());
      calendar.row = {
        ingestFailureCount: state.failureCount,
        ingestLastFailureAt: state.lastFailureAt,
        ingestNextAttemptAt: state.nextAttemptAt,
      };
      calendar.writes.push({ kind: "apply", row: calendar.row });
      return Promise.resolve(state);
    },
    readAttempt: () => Promise.resolve({
      failureCount: calendar.row.ingestFailureCount,
      nextAttemptAt: calendar.row.ingestNextAttemptAt,
    }),
    recordBackoff: (state) => {
      calendar.recorded.push(state);
    },
    resetBackoff: () => {
      calendar.row = {
        ingestFailureCount: 0,
        ingestLastFailureAt: null,
        ingestNextAttemptAt: null,
      };
      calendar.writes.push({ kind: "reset", row: calendar.row });
      return Promise.resolve();
    },
  };

  return calendar;
};

const cleanRow = (): CalendarRow => ({
  ingestFailureCount: 0,
  ingestLastFailureAt: null,
  ingestNextAttemptAt: null,
});

const credentialError = (): Error =>
  Object.assign(new Error("Token refresh failed (400): invalid_grant"), {
    oauthReauthRequired: true,
  });

const liveSignal = (): AbortSignal => new AbortController().signal;

const tick = (calendar: Calendar, work: () => Promise<unknown>): Promise<unknown> =>
  runSourceIngest(calendar.dependencies, CALENDAR_ID, liveSignal(), work)
    .catch((error: unknown) => error);

const failingWork = () => Promise.reject(credentialError());
const successfulWork = () => Promise.resolve({ eventsAdded: 0, eventsRemoved: 0 });

const advanceToNextAttempt = (calendar: Calendar): void => {
  const nextAttemptAt = calendar.row.ingestNextAttemptAt;
  if (!nextAttemptAt) {
    return;
  }
  vi.setSystemTime(nextAttemptAt);
};

describe("an attempt clock cleared by hand while the failure count stayed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  it("resets the leftover count when the source succeeds", async () => {
    const calendar = createCalendar({
      ingestFailureCount: 7,
      ingestLastFailureAt: new Date(START_AT.getTime() - MAX_BACKOFF_MS),
      ingestNextAttemptAt: null,
    });

    await tick(calendar, successfulWork);

    expect(calendar.writes.map(({ kind }) => kind)).toEqual(["reset"]);
    expect(calendar.row).toEqual(cleanRow());
  });

  it("ladders from the stored count rather than restarting when it fails again", async () => {
    const calendar = createCalendar({
      ingestFailureCount: 7,
      ingestLastFailureAt: new Date(START_AT.getTime() - MAX_BACKOFF_MS),
      ingestNextAttemptAt: null,
    });

    await tick(calendar, failingWork);

    expect(calendar.row.ingestFailureCount).toBe(8);
    expect(calendar.row.ingestNextAttemptAt)
      .toEqual(new Date(START_AT.getTime() + MAX_BACKOFF_MS));
  });
});

describe("a source that keeps failing forever", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  it("never shrinks the delay, never exceeds the cap and never loses count", async () => {
    const calendar = createCalendar(cleanRow());
    const delays: number[] = [];

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const startedAt = Date.now();
      await tick(calendar, failingWork);
      const nextAttemptAt = calendar.row.ingestNextAttemptAt;
      expect(nextAttemptAt).not.toBeNull();
      expect(Number.isNaN(nextAttemptAt?.getTime())).toBe(false);
      delays.push((nextAttemptAt?.getTime() ?? 0) - startedAt);
      advanceToNextAttempt(calendar);
    }

    expect(calendar.row.ingestFailureCount).toBe(40);
    expect(calendar.writes).toHaveLength(40);
    expect(delays.slice(0, 8)).toEqual([5, 10, 20, 40, 80, 160, 320, 360].map((minutes) =>
      minutes * MINUTE_MS));
    expect(delays.slice(8)).toEqual(delays.slice(8).map(() => MAX_BACKOFF_MS));
    expect(delays.toSorted((left, right) => left - right)).toEqual(delays);
  });
});

describe("a source alternating between failing and recovering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  it("returns to exactly the clean state after every recovery", async () => {
    const calendar = createCalendar(cleanRow());

    for (let cycle = 0; cycle < 10; cycle += 1) {
      await tick(calendar, failingWork);
      expect(calendar.row.ingestFailureCount).toBe(1);
      expect(calendar.row.ingestNextAttemptAt)
        .toEqual(new Date(Date.now() + 5 * MINUTE_MS));

      advanceToNextAttempt(calendar);
      await tick(calendar, successfulWork);
      expect(calendar.row).toEqual(cleanRow());
    }

    expect(calendar.writes.filter(({ kind }) => kind === "apply")).toHaveLength(10);
    expect(calendar.writes.filter(({ kind }) => kind === "reset")).toHaveLength(10);
  });
});

describe("a healthy source at rest", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  it("writes nothing at all across a hundred successful ticks", async () => {
    const calendar = createCalendar(cleanRow());

    for (let attempt = 0; attempt < 100; attempt += 1) {
      vi.setSystemTime(new Date(START_AT.getTime() + attempt * MINUTE_MS));
      await tick(calendar, successfulWork);
    }

    expect(calendar.writes).toEqual([]);
    expect(calendar.row).toEqual(cleanRow());
  });
});

describe("a reconnect that lands after the failing run already armed the backoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  it("leaves the source due immediately rather than parked behind the old clock", async () => {
    const calendar = createCalendar({
      ingestFailureCount: 8,
      ingestLastFailureAt: new Date(START_AT.getTime() - MAX_BACKOFF_MS),
      ingestNextAttemptAt: new Date(START_AT.getTime() - MINUTE_MS),
    });

    await tick(calendar, failingWork);
    calendar.row = cleanRow();

    expect(isAttemptDue({ failureCount: 0, nextAttemptAt: null }, new Date())).toBe(true);

    await tick(calendar, successfulWork);

    expect(calendar.writes.map(({ kind }) => kind)).toEqual(["apply"]);
    expect(calendar.row).toEqual(cleanRow());
  });
});

describe("the due boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  it("holds a source back for one more millisecond and releases it on the next", () => {
    const attempt = { failureCount: 1, nextAttemptAt: new Date(START_AT.getTime() + 1) };

    expect(isAttemptDue(attempt, START_AT)).toBe(false);
    expect(isAttemptDue(attempt, new Date(START_AT.getTime() + 1))).toBe(true);
  });

  it("treats an absent clock as due no matter how many failures preceded it", () => {
    expect(isAttemptDue({ failureCount: 99, nextAttemptAt: null }, START_AT)).toBe(true);
  });
});
