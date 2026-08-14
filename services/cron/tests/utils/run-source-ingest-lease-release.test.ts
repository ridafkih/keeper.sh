import { buildCalendarBackoffState } from "@keeper.sh/calendar";
import type { CalendarBackoffState } from "@keeper.sh/calendar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSourceIngest } from "../../src/utils/run-source-ingest";
import type { SourceIngestAttempt, SourceIngestDependencies } from "../../src/utils/run-source-ingest";

const CALENDAR_ID = "6f2a5b41-77c3-4a9e-8b2d-5d1e0c9a4477";
const MINUTE_MS = 60_000;
const MAX_BACKOFF_MS = 6 * 60 * MINUTE_MS;
const INITIAL_BACKOFF_MS = 5 * MINUTE_MS;
const START_AT = new Date("2026-08-12T09:00:00.000Z");

interface CalendarRow {
  ingestFailureCount: number;
  ingestLastFailureAt: Date | null;
  ingestNextAttemptAt: Date | null;
}

interface CalendarOptions {
  beforeApplyBackoff?: () => Promise<void> | void;
  isCurrent?: () => Promise<boolean>;
  releaseError?: Error;
  resetError?: Error;
}

interface Calendar {
  dependencies: SourceIngestDependencies;
  recorded: CalendarBackoffState[];
  releases: number;
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
    releases: 0,
    row,
    writes: [],
  };

  calendar.dependencies = {
    acquireLease: () => Promise.resolve({
      isCurrent: options.isCurrent ?? (() => Promise.resolve(true)),
      release: () => {
        calendar.releases += 1;
        if (options.releaseError) {
          return Promise.reject(options.releaseError);
        }
        return Promise.resolve();
      },
    }),
    applyBackoff: async (_calendarId, observedAttempt) => {
      await options.beforeApplyBackoff?.();
      if (!rowMatchesObservedAttempt(calendar.row, observedAttempt)) {
        return null;
      }
      const state = buildCalendarBackoffState(observedAttempt.failureCount, new Date());
      calendar.row.ingestFailureCount = state.failureCount;
      calendar.row.ingestLastFailureAt = state.lastFailureAt;
      calendar.row.ingestNextAttemptAt = state.nextAttemptAt;
      calendar.writes.push("apply");
      return state;
    },
    readAttempt: () => Promise.resolve({
      failureCount: calendar.row.ingestFailureCount,
      nextAttemptAt: calendar.row.ingestNextAttemptAt,
    }),
    recordBackoff: (state) => {
      calendar.recorded.push(state);
    },
    resetBackoff: () => {
      if (options.resetError) {
        return Promise.reject(options.resetError);
      }
      calendar.row.ingestFailureCount = 0;
      calendar.row.ingestLastFailureAt = null;
      calendar.row.ingestNextAttemptAt = null;
      calendar.writes.push("reset");
      return Promise.resolve();
    },
  };

  return calendar;
};

const healthyRow = (): CalendarRow => ({
  ingestFailureCount: 0,
  ingestLastFailureAt: null,
  ingestNextAttemptAt: null,
});

const reconnect = (calendar: Calendar): void => {
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

describe("releasing the ingest lease", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the ingest result when the lease release hits a Redis blip", async () => {
    const releaseError = new Error("Connection is closed.");
    const calendar = createCalendar(healthyRow(), { releaseError });

    const result = await tick(calendar, () => Promise.resolve({ eventsAdded: 3 }));

    expect(calendar.releases).toBe(1);
    expect(result).toEqual({ eventsAdded: 3 });
  });

  it("keeps the credential failure classifiable when the lease release fails", async () => {
    const releaseError = new Error("Connection is closed.");
    const ingestError = credentialError();
    const calendar = createCalendar(healthyRow(), { releaseError });

    const thrown = await tick(calendar, () => Promise.reject(ingestError));

    expect(thrown).toBe(ingestError);
  });

  it("still arms the backoff when the lease release fails after a credential failure", async () => {
    const calendar = createCalendar(healthyRow(), {
      releaseError: new Error("Connection is closed."),
    });

    await tick(calendar, () => Promise.reject(credentialError()));

    expect(calendar.row.ingestFailureCount).toBe(1);
    expect(calendar.row.ingestNextAttemptAt).toEqual(
      new Date(START_AT.getTime() + INITIAL_BACKOFF_MS),
    );
  });
});

describe("a reconnect racing the backoff write", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves the cleared row alone when the reconnect lands between the re-read and the write", async () => {
    const racing: { calendar: Calendar | null } = { calendar: null };
    const calendar = createCalendar({
      ingestFailureCount: 9,
      ingestLastFailureAt: new Date(START_AT.getTime() - MAX_BACKOFF_MS),
      ingestNextAttemptAt: new Date(START_AT.getTime() - MINUTE_MS),
    }, {
      beforeApplyBackoff: () => {
        if (racing.calendar) {
          reconnect(racing.calendar);
        }
      },
    });
    racing.calendar = calendar;

    await tick(calendar, () => Promise.reject(credentialError()));

    expect(calendar.writes).toEqual([]);
    expect(calendar.recorded).toEqual([]);
    expect(calendar.row.ingestFailureCount).toBe(0);
    expect(calendar.row.ingestNextAttemptAt).toBeNull();
  });

  it("restarts at the first step rather than the cap when the reconnected source fails again", async () => {
    const calendar = createCalendar({
      ingestFailureCount: 9,
      ingestLastFailureAt: new Date(START_AT.getTime() - MAX_BACKOFF_MS),
      ingestNextAttemptAt: new Date(START_AT.getTime() - MINUTE_MS),
    });

    reconnect(calendar);

    await tick(calendar, () => Promise.reject(credentialError()));

    expect(calendar.row.ingestFailureCount).toBe(1);
    expect(calendar.row.ingestNextAttemptAt).toEqual(
      new Date(START_AT.getTime() + INITIAL_BACKOFF_MS),
    );
  });

  it("skips the backoff only once when a manual sync clears nextAttemptAt mid-run", async () => {
    const calendar = createCalendar({
      ingestFailureCount: 5,
      ingestLastFailureAt: new Date(START_AT.getTime() - MINUTE_MS),
      ingestNextAttemptAt: new Date(START_AT.getTime() - MINUTE_MS),
    });

    await tick(calendar, async () => {
      await Promise.resolve();
      calendar.row.ingestNextAttemptAt = null;
      throw credentialError();
    });

    expect(calendar.writes).toEqual([]);
    expect(calendar.row.ingestFailureCount).toBe(5);

    await tick(calendar, () => Promise.reject(credentialError()));

    expect(calendar.writes).toEqual(["apply"]);
    expect(calendar.row.ingestFailureCount).toBe(6);
    expect(calendar.row.ingestNextAttemptAt).not.toBeNull();
  });

  it("does not re-arm any calendar of an account reconnected while five ingests are in flight", async () => {
    const calendars = Array.from({ length: 5 }, () => createCalendar({
      ingestFailureCount: 9,
      ingestLastFailureAt: new Date(START_AT.getTime() - MAX_BACKOFF_MS),
      ingestNextAttemptAt: new Date(START_AT.getTime() - MINUTE_MS),
    }));

    const runs = calendars.map((calendar) =>
      tick(calendar, async () => {
        await Promise.resolve();
        for (const entry of calendars) {
          reconnect(entry);
        }
        throw credentialError();
      }));

    await Promise.all(runs);

    for (const calendar of calendars) {
      expect(calendar.row.ingestFailureCount).toBe(0);
      expect(calendar.row.ingestNextAttemptAt).toBeNull();
      expect(calendar.writes).toEqual([]);
    }
  });
});

describe("bookkeeping failures on a good run", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the ingest result and converges on a later tick when the reset write fails", async () => {
    const row: CalendarRow = {
      ingestFailureCount: 4,
      ingestLastFailureAt: new Date(START_AT.getTime() - MINUTE_MS),
      ingestNextAttemptAt: new Date(START_AT.getTime() - MINUTE_MS),
    };
    const failing = createCalendar(row, { resetError: new Error("statement timeout") });

    expect(await tick(failing, () => Promise.resolve("ingested"))).toBe("ingested");
    expect(failing.row.ingestFailureCount).toBe(4);

    const recovered = createCalendar(row);
    expect(await tick(recovered, () => Promise.resolve("ingested"))).toBe("ingested");
    expect(recovered.row.ingestFailureCount).toBe(0);
    expect(recovered.row.ingestNextAttemptAt).toBeNull();
  });

  it("resets the backoff of a run whose lease was superseded", async () => {
    const calendar = createCalendar({
      ingestFailureCount: 3,
      ingestLastFailureAt: new Date(START_AT.getTime() - MINUTE_MS),
      ingestNextAttemptAt: new Date(START_AT.getTime() - MINUTE_MS),
    }, { isCurrent: () => Promise.resolve(false) });

    expect(await tick(calendar, () => Promise.resolve("ingested"))).toBe("ingested");
    expect(calendar.writes).toEqual(["reset"]);
    expect(calendar.row.ingestFailureCount).toBe(0);
  });
});

describe("long-run convergence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never shrinks the delay inside a failure streak and never exceeds the cap", async () => {
    const calendar = createCalendar(healthyRow());
    const delays: number[] = [];

    for (let minute = 0; minute < 3000; minute += 1) {
      vi.setSystemTime(new Date(START_AT.getTime() + minute * MINUTE_MS));
      const before = calendar.row.ingestNextAttemptAt;
      await tick(calendar, () => Promise.reject(credentialError()));
      const after = calendar.row.ingestNextAttemptAt;
      if (after && after !== before) {
        delays.push(after.getTime() - Date.now());
      }
    }

    expect(delays.length).toBeGreaterThan(5);
    expect(Math.min(...delays)).toBe(INITIAL_BACKOFF_MS);
    expect(Math.max(...delays)).toBe(MAX_BACKOFF_MS);
    expect(delays.toSorted((left, right) => left - right)).toEqual(delays);
    expect(calendar.row.ingestFailureCount).toBe(delays.length);
  });

  it("recovers to unthrottled polling after a streak and re-arms from zero", async () => {
    const calendar = createCalendar(healthyRow());

    for (let attempt = 0; attempt < 4; attempt += 1) {
      vi.setSystemTime(new Date(calendar.row.ingestNextAttemptAt?.getTime() ?? START_AT.getTime()));
      await tick(calendar, () => Promise.reject(credentialError()));
    }
    expect(calendar.row.ingestFailureCount).toBe(4);

    vi.setSystemTime(calendar.row.ingestNextAttemptAt ?? START_AT);
    await tick(calendar, () => Promise.resolve("ingested"));
    expect(calendar.row.ingestFailureCount).toBe(0);
    expect(calendar.row.ingestNextAttemptAt).toBeNull();

    const failedAt = new Date(Date.now() + MINUTE_MS);
    vi.setSystemTime(failedAt);
    await tick(calendar, () => Promise.reject(credentialError()));
    expect(calendar.row.ingestNextAttemptAt).toEqual(
      new Date(failedAt.getTime() + INITIAL_BACKOFF_MS),
    );
  });
});
