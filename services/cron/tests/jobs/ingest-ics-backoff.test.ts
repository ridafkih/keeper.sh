import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CALENDAR_ID = "9d2f4a61-7b3c-4e58-8f10-2c6d5a8b3e47";
const USER_ID = "1e3a5c72-8d4b-4f69-9021-3d7e6b9c4f58";
const START_AT = new Date("2026-08-12T09:00:00.000Z");
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const MAX_BACKOFF_MS = 6 * HOUR_MS;
const RESUMED_CALENDAR_STATE = {
  disabled: false,
  ingestFailureCount: 0,
  ingestLastFailureAt: null,
  ingestNextAttemptAt: null,
} as const;

interface CalendarRow {
  disabled: boolean;
  ingestFailureCount: number;
  ingestLastFailureAt: Date | null;
  ingestNextAttemptAt: Date | null;
}

interface RecordedWrite {
  table: string;
  values: Record<string, unknown>;
}

const tableNames = new Map<unknown, string>([
  [calendarAccountsTable, "calendar_accounts"],
  [calendarsTable, "calendars"],
]);

const state: {
  calendar: CalendarRow;
  fetchCalls: number;
  ingestCalls: number;
  runIngest: () => Promise<{ eventsAdded: number; eventsRemoved: number }>;
  updates: RecordedWrite[];
} = {
  calendar: {
    disabled: false,
    ingestFailureCount: 0,
    ingestLastFailureAt: null,
    ingestNextAttemptAt: null,
  },
  fetchCalls: 0,
  ingestCalls: 0,
  runIngest: () => Promise.resolve({ eventsAdded: 0, eventsRemoved: 0 }),
  updates: [],
};

const resolveTableName = (table: unknown): string => {
  const name = tableNames.get(table);
  if (!name) {
    throw new Error("Unexpected table written by the ingest job");
  }
  return name;
};

const icsSourceRow = () => ({
  calendarId: CALENDAR_ID,
  ingestFutureRange: "3_months",
  ingestHistoricRange: "1_month",
  ingestWindowRecordedAt: null,
  treatFullDayTimedEventsAsAllDay: false,
  url: "https://feeds.example.com/private/basic.ics",
  userId: USER_ID,
});

const resolveSelectRows = (columns: Record<string, unknown>): unknown[] => {
  if ("failureCount" in columns) {
    return [{
      failureCount: state.calendar.ingestFailureCount,
      nextAttemptAt: state.calendar.ingestNextAttemptAt,
    }];
  }
  if ("syncFutureRange" in columns) {
    return [];
  }
  if ("externalCalendarId" in columns || "encryptedPassword" in columns) {
    return [];
  }
  if ("url" in columns) {
    if (state.calendar.disabled) {
      return [];
    }
    return [icsSourceRow()];
  }
  return [];
};

type QueryChain = Promise<unknown[]> & Record<string, unknown>;

const createChain = (rows: unknown[]): QueryChain => {
  const chain = Promise.resolve(rows) as QueryChain;
  const passthrough = () => chain;
  chain.from = passthrough;
  chain.innerJoin = passthrough;
  chain.leftJoin = passthrough;
  chain.where = passthrough;
  chain.limit = passthrough;
  chain.orderBy = passthrough;
  chain.returning = passthrough;
  return chain;
};

const applyCalendarWrite = (values: Record<string, unknown>): void => {
  if (!("ingestFailureCount" in values)) {
    return;
  }
  state.calendar = {
    ...state.calendar,
    ingestFailureCount: values.ingestFailureCount as number,
    ingestLastFailureAt: (values.ingestLastFailureAt ?? null) as Date | null,
    ingestNextAttemptAt: (values.ingestNextAttemptAt ?? null) as Date | null,
  };
};

const databaseStub = {
  execute: () => Promise.resolve(),
  select: (columns: Record<string, unknown>) => createChain(resolveSelectRows(columns)),
  transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(databaseStub),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => {
      const name = resolveTableName(table);
      state.updates.push({ table: name, values });
      if (name === "calendars") {
        applyCalendarWrite(values);
        return createChain([{ id: CALENDAR_ID }]);
      }
      return createChain([]);
    },
  }),
};

vi.mock("@/context", () => ({
  database: databaseStub,
  refreshLockRedis: {},
  refreshLockStore: {},
}));

vi.mock("@/env", () => ({
  default: {
    BLOCK_PRIVATE_RESOLUTION: false,
    DATABASE_URL: "postgres://localhost:5432/keeper",
    REDIS_URL: "redis://localhost:6379",
  },
}));

vi.mock("@keeper.sh/sync", () => ({
  createSyncLock: () => ({
    acquire: () => Promise.resolve({
      acquired: true,
      handle: {
        isCurrent: () => Promise.resolve(true),
        release: () => Promise.resolve(),
      },
    }),
  }),
}));

vi.mock("@keeper.sh/calendar/ics", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createIcsSourceFetcher: () => ({
      fetchEvents: () => {
        state.fetchCalls += 1;
        return Promise.resolve({ events: [] });
      },
    }),
  };
});

vi.mock("@/utils/enqueue-destination-syncs", () => ({
  enqueueDestinationSyncsForUsers: () => Promise.resolve(),
}));

vi.mock("@/utils/logging", () => ({
  context: (callback: () => Promise<unknown>) => callback(),
  widelog: {
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    set: () => null,
    time: {
      measure: (_name: string, callback: () => Promise<unknown>) => callback(),
    },
  },
}));

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ingestSource: () => {
      state.ingestCalls += 1;
      return state.runIngest();
    },
  };
});

const ingestSourcesModule = await import("../../src/jobs/ingest-sources");
const ingestSourcesJob = ingestSourcesModule.default;

const runTick = (): Promise<unknown> => (ingestSourcesJob.callback() as Promise<void>)
  .catch((error: unknown) => error);

const feedGone = (): Error =>
  Object.assign(new Error("Request failed with status 503"), { status: 503 });

const calendarWrites = (): RecordedWrite[] =>
  state.updates.filter(({ table }) => table === "calendars");

const resetState = (): void => {
  state.calendar = {
    disabled: false,
    ingestFailureCount: 0,
    ingestLastFailureAt: null,
    ingestNextAttemptAt: null,
  };
  state.fetchCalls = 0;
  state.ingestCalls = 0;
  state.runIngest = () => Promise.resolve({ eventsAdded: 0, eventsRemoved: 0 });
  state.updates = [];
};

describe("ingesting a subscribed ICS feed that keeps failing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
    resetState();
  });

  it("arms the backoff instead of retrying the dead feed every minute", async () => {
    state.runIngest = () => Promise.reject(feedGone());

    await runTick();

    expect(state.ingestCalls).toBe(1);
    expect(calendarWrites()[0]?.values).toMatchObject({ ingestFailureCount: 1 });
    expect(state.calendar.ingestNextAttemptAt).not.toBeNull();
  });

  it("never flags an account, because a subscribed feed has no credential to reconnect", async () => {
    state.runIngest = () => Promise.reject(feedGone());

    await runTick();

    expect(state.updates.filter(({ table }) => table === "calendar_accounts")).toEqual([]);
  });

  it("grows the delay monotonically, caps it, and attempts far less than once a minute", async () => {
    state.runIngest = () => Promise.reject(feedGone());
    const delays: number[] = [];

    for (let tick = 0; tick < 24 * 60; tick += 1) {
      vi.setSystemTime(new Date(START_AT.getTime() + tick * MINUTE_MS));
      const before = state.calendar.ingestFailureCount;
      await runTick();
      if (state.calendar.ingestFailureCount === before) {
        continue;
      }
      const armedAt = state.calendar.ingestNextAttemptAt?.getTime() ?? 0;
      delays.push(armedAt - Date.now());
    }

    expect(delays.length).toBe(state.calendar.ingestFailureCount);
    expect(delays.length).toBeLessThan(15);
    expect(state.ingestCalls).toBe(delays.length);
    expect(delays.toSorted((left, right) => left - right)).toEqual(delays);
    expect(Math.max(...delays)).toBeLessThanOrEqual(MAX_BACKOFF_MS);
  });

  it("writes nothing at all on the ticks that fall inside the armed window", async () => {
    state.runIngest = () => Promise.reject(feedGone());
    await runTick();
    state.updates = [];
    state.ingestCalls = 0;

    for (let tick = 1; tick <= 4; tick += 1) {
      vi.setSystemTime(new Date(START_AT.getTime() + tick * MINUTE_MS));
      await runTick();
    }

    expect(state.ingestCalls).toBe(0);
    expect(state.updates).toEqual([]);
  });

  it("returns to unthrottled polling the moment the feed comes back", async () => {
    state.runIngest = () => Promise.reject(feedGone());
    await runTick();

    vi.setSystemTime(new Date(START_AT.getTime() + 6 * MINUTE_MS));
    state.runIngest = () => Promise.resolve({ eventsAdded: 2, eventsRemoved: 0 });
    await runTick();

    expect(state.calendar).toMatchObject({
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    });

    state.updates = [];
    vi.setSystemTime(new Date(START_AT.getTime() + 7 * MINUTE_MS));
    await runTick();
    expect(state.updates).toEqual([]);
  });
});

describe("re-enabling a source whose ingest backoff clock is still armed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
    resetState();
    state.calendar = {
      disabled: true,
      ingestFailureCount: 9,
      ingestLastFailureAt: new Date(START_AT.getTime() - HOUR_MS),
      ingestNextAttemptAt: new Date(START_AT.getTime() + MAX_BACKOFF_MS - HOUR_MS),
    };
  });

  it("polls the source on the next tick once the user un-pauses it", async () => {
    state.calendar = { ...state.calendar, ...RESUMED_CALENDAR_STATE };

    vi.setSystemTime(new Date(START_AT.getTime() + MINUTE_MS));
    await runTick();

    expect(state.ingestCalls).toBe(1);
  });

  it("stays throttled if the clock is left armed, so the resume must clear it", async () => {
    state.calendar = { ...state.calendar, disabled: false };

    vi.setSystemTime(new Date(START_AT.getTime() + MINUTE_MS));
    await runTick();

    expect(state.ingestCalls).toBe(0);
  });
});
