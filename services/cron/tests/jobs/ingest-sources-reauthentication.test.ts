import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dialect = new PgDialect();

const CALENDAR_ID = "3f0b6d21-5c8e-4a17-9d3b-1e7c2a9f4d60";
const ACCOUNT_ID = "4a1c7e32-6d9f-4b28-ae4c-2f8d3b0a5e71";
const CREDENTIAL_ID = "5b2d8f43-7e0a-4c39-bf5d-3a9e4c1b6f82";
const USER_ID = "6c3e9a54-8f1b-4d40-a06e-4b0f5d2c7a93";
const EXTERNAL_CALENDAR_ID = "primary";
const START_AT = new Date("2026-08-12T09:00:00.000Z");
const MINUTE_MS = 60_000;

interface CalendarRow {
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
  account: { needsReauthentication: boolean };
  calendar: CalendarRow;
  ingestCalls: number;
  runIngest: () => Promise<{ eventsAdded: number; eventsRemoved: number }>;
  updates: RecordedWrite[];
} = {
  account: { needsReauthentication: false },
  calendar: {
    ingestFailureCount: 0,
    ingestLastFailureAt: null,
    ingestNextAttemptAt: null,
  },
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

const oauthSourceRow = () => ({
  accessToken: "stale-access-token",
  accountId: ACCOUNT_ID,
  expiresAt: new Date(START_AT.getTime() + 30 * MINUTE_MS),
  externalCalendarId: EXTERNAL_CALENDAR_ID,
  ingestFutureRange: "3_months",
  ingestHistoricRange: "1_month",
  ingestWindowEnd: null,
  ingestWindowRecordedAt: null,
  ingestWindowStart: null,
  oauthCredentialId: CREDENTIAL_ID,
  provider: "google",
  refreshToken: "revoked-refresh-token",
  syncToken: null,
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
  if ("encryptedPassword" in columns || "url" in columns) {
    return [];
  }
  if ("calendarId" in columns) {
    return [{ ...oauthSourceRow(), calendarId: CALENDAR_ID }];
  }
  return [oauthSourceRow()];
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
    ingestFailureCount: values.ingestFailureCount as number,
    ingestLastFailureAt: (values.ingestLastFailureAt ?? null) as Date | null,
    ingestNextAttemptAt: (values.ingestNextAttemptAt ?? null) as Date | null,
  };
};

const liveRows = (): Record<string, Record<string, unknown>> => ({
  calendar_accounts: {
    id: ACCOUNT_ID,
    needsReauthentication: state.account.needsReauthentication,
    oauthCredentialId: CREDENTIAL_ID,
  },
  oauth_credentials: {
    id: CREDENTIAL_ID,
    refreshToken: oauthSourceRow().refreshToken,
  },
});

const COLUMN_COMPARISON = /"(\w+)"\."(\w+)" (=|<>) \$(\d+)/g;

const guardMatchesLiveRows = (text: string, params: unknown[]): boolean => {
  const rows = liveRows();
  const comparisons = [...text.matchAll(COLUMN_COMPARISON)];
  if (comparisons.length === 0) {
    throw new Error(`Reauthentication flag written with an unreadable guard: ${text}`);
  }
  return comparisons.every(([, table, column, operator, index]) => {
    const row = rows[table ?? ""];
    if (!row) {
      throw new Error(`Reauthentication guard read an unmodelled table: ${table ?? ""}`);
    }
    const matches = row[column ?? ""] === params[Number(index) - 1];
    if (operator === "<>") {
      return !matches;
    }
    return matches;
  });
};

const applyAccountFlag = (values: Record<string, unknown>, condition: SQL | undefined): unknown[] => {
  if (condition) {
    const query = dialect.sqlToQuery(condition);
    if (!guardMatchesLiveRows(query.sql, query.params)) {
      return [];
    }
  }

  state.updates.push({ table: "calendar_accounts", values });
  state.account.needsReauthentication = values.needsReauthentication === true;
  return [{ id: ACCOUNT_ID }];
};

const databaseStub = {
  execute: () => Promise.resolve(),
  select: (columns: Record<string, unknown>) => createChain(resolveSelectRows(columns)),
  transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(databaseStub),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => {
      const name = resolveTableName(table);
      if (name === "calendars") {
        state.updates.push({ table: name, values });
        applyCalendarWrite(values);
        return createChain([{ id: CALENDAR_ID }]);
      }
      return {
        where: (condition: SQL | undefined) => createChain(applyAccountFlag(values, condition)),
      };
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

vi.mock("@keeper.sh/calendar/google", () => ({
  createGoogleSourceFetcher: () => ({
    fetchEvents: () => Promise.resolve({ events: [] }),
  }),
}));

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

const runTick = (): Promise<void> => ingestSourcesJob.callback() as Promise<void>;

const deadCredentialError = (): Error =>
  Object.assign(new Error("Token refresh failed (400): invalid_grant"), {
    oauthReauthRequired: true,
  });

const reconnect = (): void => {
  state.calendar = {
    ingestFailureCount: 0,
    ingestLastFailureAt: null,
    ingestNextAttemptAt: null,
  };
  state.account.needsReauthentication = false;
};

const calendarWrites = (): RecordedWrite[] =>
  state.updates.filter(({ table }) => table === "calendars");

const accountWrites = (): RecordedWrite[] =>
  state.updates.filter(({ table }) => table === "calendar_accounts");

describe("ingesting an OAuth source whose credential died", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
    state.account = { needsReauthentication: false };
    state.calendar = {
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    };
    state.ingestCalls = 0;
    state.runIngest = () => Promise.resolve({ eventsAdded: 0, eventsRemoved: 0 });
    state.updates = [];
  });

  it("arms the backoff and flags the account instead of failing the whole job", async () => {
    state.runIngest = () => Promise.reject(deadCredentialError());

    await expect(runTick()).resolves.toBeUndefined();

    expect(calendarWrites()[0]?.values).toMatchObject({ ingestFailureCount: 1 });
    expect(state.calendar.ingestNextAttemptAt).toEqual(new Date(START_AT.getTime() + 5 * MINUTE_MS));
    expect(accountWrites()[0]?.values).toMatchObject({ needsReauthentication: true });
  });

  it("neither calls the provider nor rewrites any row on a tick inside the backoff window", async () => {
    state.calendar = {
      ingestFailureCount: 3,
      ingestLastFailureAt: START_AT,
      ingestNextAttemptAt: new Date(START_AT.getTime() + 40 * MINUTE_MS),
    };
    state.runIngest = () => Promise.reject(deadCredentialError());

    await runTick();

    expect(state.ingestCalls).toBe(0);
    expect(state.updates).toEqual([]);
  });

  it("clears the ingest backoff and the demand it is entitled to adjudicate once the source works again", async () => {
    state.calendar = {
      ingestFailureCount: 4,
      ingestLastFailureAt: new Date(START_AT.getTime() - 80 * MINUTE_MS),
      ingestNextAttemptAt: new Date(START_AT.getTime() - MINUTE_MS),
    };
    state.account = { needsReauthentication: true };

    await runTick();

    expect(calendarWrites().map(({ values }) => values)).toEqual([{
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    }]);
    expect(accountWrites().map(({ values }) => values)).toEqual([{
      needsReauthentication: false,
      reauthenticationSource: null,
    }]);
    expect(state.account.needsReauthentication).toBe(false);
  });

  it("settles instead of rewriting the demand on every later healthy tick", async () => {
    state.calendar = {
      ingestFailureCount: 4,
      ingestLastFailureAt: new Date(START_AT.getTime() - 80 * MINUTE_MS),
      ingestNextAttemptAt: new Date(START_AT.getTime() - MINUTE_MS),
    };
    state.account = { needsReauthentication: true };

    await runTick();
    state.updates = [];
    await runTick();
    await runTick();

    expect(accountWrites()).toEqual([]);
    expect(state.account.needsReauthentication).toBe(false);
  });
});

describe("a reconnect that lands while the dead-credential ingest is still running", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
    state.account = { needsReauthentication: true };
    state.calendar = {
      ingestFailureCount: 3,
      ingestLastFailureAt: new Date(START_AT.getTime() - 40 * MINUTE_MS),
      ingestNextAttemptAt: new Date(START_AT.getTime() - MINUTE_MS),
    };
    state.ingestCalls = 0;
    state.updates = [];
    state.runIngest = () => {
      reconnect();
      return Promise.reject(deadCredentialError());
    };
  });

  it("leaves the cleared attempt clock alone so the source resumes on the next tick", async () => {
    await runTick();

    expect(calendarWrites()).toEqual([]);
    expect(state.calendar).toEqual({
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    });
  });

  it("does not re-raise the reauthentication marker the reconnect just cleared", async () => {
    await runTick();

    expect(state.account.needsReauthentication).toBe(false);
  });

  it("leaves the marker cleared on every later tick that ingests successfully", async () => {
    await runTick();
    state.runIngest = () => Promise.resolve({ eventsAdded: 2, eventsRemoved: 0 });

    await runTick();
    await runTick();

    expect(state.ingestCalls).toBe(3);
    expect(accountWrites()).toEqual([]);
    expect(state.account.needsReauthentication).toBe(false);
  });
});
