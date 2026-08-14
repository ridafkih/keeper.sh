import { buildCalendarBackoffState } from "@keeper.sh/calendar";
import type { CalendarBackoffState } from "@keeper.sh/calendar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSourceIngest } from "../../src/utils/run-source-ingest";
import type {
  SourceIngestAttempt,
  SourceIngestDependencies,
  SourceIngestHandlers,
  SourceIngestLease,
} from "../../src/utils/run-source-ingest";

const CALENDAR_ID = "c3d4e5f6-0718-4293-be5f-60718293a4b5";
const MINUTE_MS = 60_000;
const INITIAL_BACKOFF_MS = 5 * MINUTE_MS;
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
  writes: string[];
}

interface CalendarOptions {
  isCurrent?: () => Promise<boolean>;
}

const cleanRow = (): CalendarRow => ({
  ingestFailureCount: 0,
  ingestLastFailureAt: null,
  ingestNextAttemptAt: null,
});

const matchesObserved = (row: CalendarRow, observed: SourceIngestAttempt): boolean =>
  row.ingestFailureCount === observed.failureCount
  && (row.ingestNextAttemptAt?.getTime() ?? null) === (observed.nextAttemptAt?.getTime() ?? null);

const createCalendar = (row: CalendarRow, options: CalendarOptions = {}): Calendar => {
  const calendar: Calendar = {
    dependencies: {} as SourceIngestDependencies,
    recorded: [],
    row,
    writes: [],
  };

  calendar.dependencies = {
    acquireLease: (): Promise<SourceIngestLease | null> => Promise.resolve({
      isCurrent: () => options.isCurrent?.() ?? Promise.resolve(true),
      release: () => Promise.resolve(),
    }),
    applyBackoff: (_calendarId, observedAttempt) => {
      if (!matchesObserved(calendar.row, observedAttempt)) {
        calendar.writes.push("skipped");
        return Promise.resolve(null);
      }
      const state = buildCalendarBackoffState(observedAttempt.failureCount, new Date());
      calendar.row = {
        ingestFailureCount: state.failureCount,
        ingestLastFailureAt: state.lastFailureAt,
        ingestNextAttemptAt: state.nextAttemptAt,
      };
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
      calendar.row = cleanRow();
      calendar.writes.push("reset");
      return Promise.resolve();
    },
  };

  return calendar;
};

const liveSignal = (): AbortSignal => new AbortController().signal;

const tick = (
  calendar: Calendar,
  work: () => Promise<unknown>,
  handlers?: SourceIngestHandlers,
): Promise<unknown> =>
  runSourceIngest(calendar.dependencies, CALENDAR_ID, liveSignal(), work, handlers)
    .catch((error: unknown) => error);

const providerError = (): Error => new Error("504 Gateway Timeout");

const advanceToDue = (calendar: Calendar): void => {
  const dueAt = calendar.row.ingestNextAttemptAt;
  if (!dueAt) {
    return;
  }
  vi.setSystemTime(new Date(dueAt));
};

describe("a source whose successful runs are always superseded", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the stored failure count on the first tick that succeeds", async () => {
    const calendar = createCalendar({
      ingestFailureCount: 6,
      ingestLastFailureAt: new Date(START_AT.getTime() - MINUTE_MS),
      ingestNextAttemptAt: new Date(START_AT.getTime() - MINUTE_MS),
    }, { isCurrent: () => Promise.resolve(false) });

    for (let index = 0; index < 50; index += 1) {
      vi.setSystemTime(new Date(START_AT.getTime() + index * MINUTE_MS));
      expect(await tick(calendar, () => Promise.resolve("ingested"))).toBe("ingested");
    }

    expect(calendar.writes).toEqual(["reset"]);
    expect(calendar.row).toEqual(cleanRow());
  });

  it("parks the source for hours on its first later failure instead of the first step", async () => {
    const calendar = createCalendar({
      ingestFailureCount: 6,
      ingestLastFailureAt: new Date(START_AT.getTime() - MINUTE_MS),
      ingestNextAttemptAt: new Date(START_AT.getTime() - MINUTE_MS),
    }, { isCurrent: () => Promise.resolve(false) });

    for (let index = 0; index < 10; index += 1) {
      vi.setSystemTime(new Date(START_AT.getTime() + index * MINUTE_MS));
      await tick(calendar, () => Promise.resolve("ingested"));
    }

    const failedAt = new Date(START_AT.getTime() + 10 * MINUTE_MS);
    vi.setSystemTime(failedAt);
    await tick(calendar, () => Promise.reject(providerError()));

    const armedFor = (calendar.row.ingestNextAttemptAt?.getTime() ?? 0) - failedAt.getTime();
    expect(armedFor).toBe(INITIAL_BACKOFF_MS);
  });

  it("converges to the clean state whether or not the tick is superseded", async () => {
    let superseded = true;
    const calendar = createCalendar({
      ingestFailureCount: 6,
      ingestLastFailureAt: new Date(START_AT.getTime() - MINUTE_MS),
      ingestNextAttemptAt: new Date(START_AT.getTime() - MINUTE_MS),
    }, { isCurrent: () => Promise.resolve(!superseded) });

    await tick(calendar, () => Promise.resolve("ingested"));
    expect(calendar.row).toEqual(cleanRow());

    superseded = false;
    await tick(calendar, () => Promise.resolve("ingested"));

    expect(calendar.row).toEqual(cleanRow());
  });
});

describe("a lease check that throws on a successful run", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the result and converges on the next healthy tick", async () => {
    let blip = true;
    const calendar = createCalendar({
      ingestFailureCount: 2,
      ingestLastFailureAt: new Date(START_AT.getTime() - MINUTE_MS),
      ingestNextAttemptAt: new Date(START_AT.getTime() - MINUTE_MS),
    }, {
      isCurrent: () => {
        if (blip) {
          return Promise.reject(new Error("Failed to renew sync lock"));
        }
        return Promise.resolve(true);
      },
    });

    expect(await tick(calendar, () => Promise.resolve("ingested"))).toBe("ingested");
    expect(calendar.row).toEqual(cleanRow());

    blip = false;
    expect(await tick(calendar, () => Promise.resolve("ingested"))).toBe("ingested");
    expect(calendar.row).toEqual(cleanRow());
  });
});

describe("a source alternating between one failure and one success", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never lets the delay grow past the first step across forty cycles", async () => {
    const calendar = createCalendar(cleanRow());
    const delays: number[] = [];

    for (let cycle = 0; cycle < 40; cycle += 1) {
      const failedAt = new Date();
      await tick(calendar, () => Promise.reject(providerError()));
      delays.push((calendar.row.ingestNextAttemptAt?.getTime() ?? 0) - failedAt.getTime());

      advanceToDue(calendar);
      await tick(calendar, () => Promise.resolve("ingested"));
      expect(calendar.row).toEqual(cleanRow());
    }

    expect(new Set(delays)).toEqual(new Set([INITIAL_BACKOFF_MS]));
  });
});

describe("the settled-failure handler across a long streak", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs exactly once per attempt that was really backed off", async () => {
    const calendar = createCalendar(cleanRow());
    let handlerRuns = 0;
    const handlers: SourceIngestHandlers = {
      onSettledFailure: () => {
        handlerRuns += 1;
      },
    };

    let attempts = 0;
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      vi.setSystemTime(new Date(START_AT.getTime() + minute * MINUTE_MS));
      const before = calendar.writes.length;
      await tick(calendar, () => Promise.reject(providerError()), handlers);
      if (calendar.writes.length > before) {
        attempts += 1;
      }
    }

    expect(handlerRuns).toBe(attempts);
    expect(calendar.row.ingestFailureCount).toBe(attempts);
    expect(calendar.writes.filter((write) => write !== "apply")).toEqual([]);
  });

  it("holds the delay at the cap rather than growing without bound", async () => {
    const calendar = createCalendar(cleanRow());

    for (let index = 0; index < 30; index += 1) {
      const failedAt = new Date();
      await tick(calendar, () => Promise.reject(providerError()));
      const armedFor = (calendar.row.ingestNextAttemptAt?.getTime() ?? 0) - failedAt.getTime();
      expect(armedFor).toBeLessThanOrEqual(MAX_BACKOFF_MS);
      advanceToDue(calendar);
    }

    expect(calendar.row.ingestFailureCount).toBe(30);
    const lastFailedAt = new Date();
    await tick(calendar, () => Promise.reject(providerError()));
    expect(
      (calendar.row.ingestNextAttemptAt?.getTime() ?? 0) - lastFailedAt.getTime(),
    ).toBe(MAX_BACKOFF_MS);
  });
});
