import { buildCalendarBackoffState } from "@keeper.sh/calendar";
import type { CalendarBackoffState } from "@keeper.sh/calendar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSourceIngest } from "../../src/utils/run-source-ingest";
import type { SourceIngestAttempt, SourceIngestDependencies } from "../../src/utils/run-source-ingest";

const CALENDAR_ID = "3d7a1c02-9f44-4e63-b0d1-6a2c8f5e1b90";
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const INITIAL_BACKOFF_MS = 5 * MINUTE_MS;
const MAX_BACKOFF_MS = 6 * HOUR_MS;
const START_AT = new Date("2026-08-12T09:00:00.000Z");

interface CalendarRow {
  ingestFailureCount: number;
  ingestLastFailureAt: Date | null;
  ingestNextAttemptAt: Date | null;
}

interface CalendarOptions {
  beforeApplyBackoff?: () => void;
}

interface Calendar {
  dependencies: SourceIngestDependencies;
  recorded: CalendarBackoffState[];
  row: CalendarRow;
  writes: string[];
}

const rowMatchesObservedAttempt = (
  row: CalendarRow,
  observed: SourceIngestAttempt,
): boolean => row.ingestFailureCount === observed.failureCount
  && (row.ingestNextAttemptAt?.getTime() ?? null) === (observed.nextAttemptAt?.getTime() ?? null);

const createCalendar = (row: CalendarRow, options: CalendarOptions = {}): Calendar => {
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
      options.beforeApplyBackoff?.();
      if (!rowMatchesObservedAttempt(calendar.row, observedAttempt)) {
        return Promise.resolve(null);
      }
      const state = buildCalendarBackoffState(observedAttempt.failureCount, new Date());
      calendar.row.ingestFailureCount = state.failureCount;
      calendar.row.ingestLastFailureAt = state.lastFailureAt;
      calendar.row.ingestNextAttemptAt = state.nextAttemptAt;
      calendar.writes.push("apply");
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
      calendar.row.ingestFailureCount = 0;
      calendar.row.ingestLastFailureAt = null;
      calendar.row.ingestNextAttemptAt = null;
      calendar.writes.push("reset");
      return Promise.resolve();
    },
  };

  return calendar;
};

const syncNow = (calendar: Calendar): void => {
  calendar.row.ingestFailureCount = 0;
  calendar.row.ingestLastFailureAt = null;
  calendar.row.ingestNextAttemptAt = null;
};

const credentialError = (): Error =>
  Object.assign(new Error("Token refresh failed (400): invalid_grant"), {
    oauthReauthRequired: true,
  });

const liveSignal = (): AbortSignal => new AbortController().signal;

const tick = (calendar: Calendar, work: () => Promise<unknown>): Promise<unknown> =>
  runSourceIngest(calendar.dependencies, CALENDAR_ID, liveSignal(), work)
    .catch((error: unknown) => error);

const backedOffRow = (failureCount: number): CalendarRow => ({
  ingestFailureCount: failureCount,
  ingestLastFailureAt: new Date(START_AT.getTime() - MAX_BACKOFF_MS),
  ingestNextAttemptAt: new Date(START_AT.getTime() - MINUTE_MS),
});

const rejectWith = (reason: unknown): Promise<never> =>
  new Promise((_resolve, reject) => {
    reject(reason);
  });

describe("a manual sync racing an in-flight ingest", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the cleared attempt clock when Sync now lands while the work is running", async () => {
    const calendar = createCalendar(backedOffRow(9));

    await tick(calendar, async () => {
      await Promise.resolve();
      syncNow(calendar);
      throw credentialError();
    });

    expect(calendar.writes).toEqual([]);
    expect(calendar.row.ingestNextAttemptAt).toBeNull();
  });

  it("keeps the cleared attempt clock when Sync now lands during the backoff write", async () => {
    const racing: { calendar: Calendar | null } = { calendar: null };
    const calendar = createCalendar(backedOffRow(9), {
      beforeApplyBackoff: () => {
        if (racing.calendar) {
          syncNow(racing.calendar);
        }
      },
    });
    racing.calendar = calendar;

    await tick(calendar, () => Promise.reject(credentialError()));

    expect(calendar.row.ingestNextAttemptAt).toBeNull();
  });

  it("does not black the source out for the maximum backoff right after a manual sync", async () => {
    const calendar = createCalendar(backedOffRow(9));
    syncNow(calendar);

    await tick(calendar, () => Promise.reject(credentialError()));

    const nextAttemptAt = calendar.row.ingestNextAttemptAt;
    expect(nextAttemptAt).not.toBeNull();
    expect((nextAttemptAt as Date).getTime() - START_AT.getTime())
      .toBeLessThan(MAX_BACKOFF_MS);
  });

  it("converges after repeated manual syncs on a source that stays broken", async () => {
    const calendar = createCalendar(backedOffRow(3));
    const delays: number[] = [];

    for (let round = 0; round < 6; round += 1) {
      syncNow(calendar);
      vi.setSystemTime(new Date(START_AT.getTime() + round * MINUTE_MS));
      await tick(calendar, () => Promise.reject(credentialError()));
      const nextAttemptAt = calendar.row.ingestNextAttemptAt;
      expect(nextAttemptAt).not.toBeNull();
      delays.push((nextAttemptAt as Date).getTime() - Date.now());
    }

    expect(calendar.row.ingestFailureCount).toBe(1);
    expect(delays.toSorted((left, right) => left - right)).toEqual(delays);
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(INITIAL_BACKOFF_MS);
    expect(Math.max(...delays)).toBeLessThanOrEqual(MAX_BACKOFF_MS);
  });
});

describe("failures that are not plain provider errors", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("arms the backoff and rethrows the original value for a non-Error throwable", async () => {
    const calendar = createCalendar(backedOffRow(0));
    calendar.row.ingestNextAttemptAt = null;

    const thrown = await tick(calendar, () => rejectWith("ECONNRESET"));

    expect(thrown).toBe("ECONNRESET");
    expect(calendar.row.ingestFailureCount).toBe(1);
  });

  it("preserves a credential failure wrapped inside an aggregate error", async () => {
    const calendar = createCalendar(backedOffRow(0));
    calendar.row.ingestNextAttemptAt = null;
    const inner = credentialError();
    const wrapper = new AggregateError([inner], "ingest failed");

    const thrown = await tick(calendar, () => Promise.reject(wrapper));

    expect(thrown).toBe(wrapper);
    expect((thrown as AggregateError).errors[0]).toBe(inner);
    expect(calendar.row.ingestFailureCount).toBe(1);
  });

  it("treats an attempt clock left far in the past by a clock jump as due", async () => {
    const calendar = createCalendar({
      ingestFailureCount: 6,
      ingestLastFailureAt: new Date(START_AT.getTime() - 30 * 24 * HOUR_MS),
      ingestNextAttemptAt: new Date(START_AT.getTime() - 30 * 24 * HOUR_MS),
    });

    expect(await tick(calendar, () => Promise.resolve("ingested"))).toBe("ingested");
    expect(calendar.row.ingestFailureCount).toBe(0);
    expect(calendar.row.ingestNextAttemptAt).toBeNull();
  });

  it("clears the backoff when the work skips because the calendar vanished mid-run", async () => {
    const calendar = createCalendar(backedOffRow(4));

    const skipped = { eventsAdded: 0, eventsRemoved: 0, skipped: true };
    expect(await tick(calendar, () => Promise.resolve(skipped))).toBe(skipped);
    expect(calendar.writes).toEqual(["reset"]);
    expect(calendar.row.ingestFailureCount).toBe(0);
  });
});
