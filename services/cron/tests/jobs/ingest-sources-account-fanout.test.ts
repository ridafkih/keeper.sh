import { calendarAccountsTable, calendarsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FIRST_CALENDAR_ID = "8a2f4c10-6b73-4d59-9e28-1c5d0a7b3e46";
const SECOND_CALENDAR_ID = "9b3e5d21-7c84-4e60-8f39-2d6e1b8c4f57";
const ACCOUNT_ID = "0c4f6e32-8d95-4f71-9a40-3e7f2c9d5a68";
const OAUTH_CREDENTIAL_ID = "1d5a7f43-9e06-4a82-8b51-4f8a3d0e6b79";
const USER_ID = "2e6b8a54-0f17-4b93-9c62-5a9b4e1f7c80";
const START_AT = new Date("2026-08-12T09:00:00.000Z");
const MINUTE_MS = 60_000;

const dialect = new PgDialect();

interface CalendarRow {
  id: string;
  ingestFailureCount: number;
  ingestLastFailureAt: Date | null;
  ingestNextAttemptAt: Date | null;
}

interface RefreshOutcome {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken?: string;
}

const state: {
  account: { id: string; needsReauthentication: boolean; oauthCredentialId: string };
  accountFlagAttempts: { flagged: boolean; refreshToken: unknown }[];
  calendars: CalendarRow[];
  calendarWrites: { id: string; values: Record<string, unknown> }[];
  credential: { accessToken: string; expiresAt: Date; refreshToken: string };
  dueCalendarIds: string[];
  refresh: () => Promise<RefreshOutcome>;
  refreshCalls: string[];
  runIngest: (calendarId: string) => Promise<{ eventsAdded: number; eventsRemoved: number }>;
} = {
  account: { id: ACCOUNT_ID, needsReauthentication: false, oauthCredentialId: OAUTH_CREDENTIAL_ID },
  accountFlagAttempts: [],
  calendars: [],
  calendarWrites: [],
  credential: {
    accessToken: "access-token-0",
    expiresAt: new Date(START_AT.getTime() - MINUTE_MS),
    refreshToken: "refresh-token-0",
  },
  dueCalendarIds: [FIRST_CALENDAR_ID, SECOND_CALENDAR_ID],
  refresh: () => Promise.resolve({ accessToken: "access-token-1", expiresInSeconds: 3600 }),
  refreshCalls: [],
  runIngest: () => Promise.resolve({ eventsAdded: 0, eventsRemoved: 0 }),
};

const findCalendar = (calendarId: string): CalendarRow => {
  const calendar = state.calendars.find(({ id }) => id === calendarId);
  if (!calendar) {
    throw new Error(`Unknown calendar ${calendarId}`);
  }
  return calendar;
};

const oauthSourceRow = (calendarId: string) => ({
  accountId: ACCOUNT_ID,
  accessToken: state.credential.accessToken,
  calendarId,
  expiresAt: state.credential.expiresAt,
  externalCalendarId: `external-${calendarId}`,
  ingestFutureRange: "3_months",
  ingestHistoricRange: "1_month",
  ingestWindowEnd: null,
  ingestWindowRecordedAt: null,
  ingestWindowStart: null,
  oauthCredentialId: OAUTH_CREDENTIAL_ID,
  provider: "outlook",
  refreshToken: state.credential.refreshToken,
  syncToken: null,
  userId: USER_ID,
});

const toComparableValue = (value: unknown): unknown => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
};

const liveRow = (table: string, row: CalendarRow | null): Record<string, unknown> => {
  if (table === "calendars") {
    return {
      id: row?.id,
      ingestFailureCount: row?.ingestFailureCount,
      ingestNextAttemptAt: row?.ingestNextAttemptAt ?? null,
    };
  }
  if (table === "calendar_accounts") {
    return { id: state.account.id, oauthCredentialId: state.account.oauthCredentialId };
  }
  if (table === "oauth_credentials") {
    return { id: OAUTH_CREDENTIAL_ID, refreshToken: state.credential.refreshToken };
  }
  throw new Error(`Condition referenced an unmodelled table: ${table}`);
};

const EQUALITY = /"(\w+)"\."(\w+)" = \$(\d+)/g;
const NULL_CHECK = /"(\w+)"\."(\w+)" is null/g;

interface ParsedCondition {
  equalities: { table: string; column: string; value: unknown }[];
  nullChecks: { table: string; column: string }[];
}

const parseCondition = (condition: SQL): ParsedCondition => {
  const query = dialect.sqlToQuery(condition);
  return {
    equalities: [...query.sql.matchAll(EQUALITY)].map(([, table, column, index]) => ({
      column: column ?? "",
      table: table ?? "",
      value: query.params[Number(index) - 1],
    })),
    nullChecks: [...query.sql.matchAll(NULL_CHECK)].map(([, table, column]) => ({
      column: column ?? "",
      table: table ?? "",
    })),
  };
};

const conditionMatches = (parsed: ParsedCondition, calendar: CalendarRow | null): boolean => {
  const matchesEquality = parsed.equalities.every(({ table, column, value }) =>
    toComparableValue(liveRow(table, calendar)[column]) === toComparableValue(value));
  const matchesNull = parsed.nullChecks.every(({ table, column }) =>
    (liveRow(table, calendar)[column] ?? null) === null);
  return matchesEquality && matchesNull;
};

const matchingCalendars = (condition: SQL | null): CalendarRow[] => {
  if (!condition) {
    return state.calendars;
  }
  const parsed = parseCondition(condition);
  return state.calendars.filter((calendar) => conditionMatches(parsed, calendar));
};

interface ChainBuilders {
  from: () => Chain;
  innerJoin: () => Chain;
  leftJoin: () => Chain;
  limit: () => Chain;
  orderBy: () => Chain;
  returning: () => Chain;
  where: (condition?: SQL) => Chain;
}

type Chain = Promise<unknown[]> & ChainBuilders;

const createChain = (resolveRows: (condition: SQL | null) => unknown[]): Chain => {
  let captured: SQL | null = null;
  const chain = new Promise<unknown[]>((resolve) => {
    queueMicrotask(() => {
      resolve(resolveRows(captured));
    });
  }) as Chain;
  const passthrough = () => chain;
  chain.from = passthrough;
  chain.innerJoin = passthrough;
  chain.leftJoin = passthrough;
  chain.limit = passthrough;
  chain.orderBy = passthrough;
  chain.returning = passthrough;
  chain.where = (condition) => {
    captured = condition ?? null;
    return chain;
  };
  return chain;
};

const resolveSelect = (columns: Record<string, unknown>, condition: SQL | null): unknown[] => {
  const keys = Object.keys(columns);
  if (keys.length === 1 && keys[0] === "refreshToken") {
    return [{ refreshToken: state.credential.refreshToken }];
  }
  if ("failureCount" in columns) {
    return matchingCalendars(condition).map((calendar) => ({
      failureCount: calendar.ingestFailureCount,
      nextAttemptAt: calendar.ingestNextAttemptAt,
    }));
  }
  if ("syncFutureRange" in columns || "url" in columns || "encryptedPassword" in columns) {
    return [];
  }
  if ("calendarId" in columns) {
    return state.dueCalendarIds.map((calendarId) => oauthSourceRow(calendarId));
  }
  return [oauthSourceRow(FIRST_CALENDAR_ID)];
};

const applyCalendarUpdate = (
  values: Record<string, unknown>,
  condition: SQL | null,
): unknown[] => {
  const matched = matchingCalendars(condition);
  for (const calendar of matched) {
    state.calendarWrites.push({ id: calendar.id, values });
    state.calendars = state.calendars.map((row) => {
      if (row.id !== calendar.id) {
        return row;
      }
      return {
        id: row.id,
        ingestFailureCount: (values.ingestFailureCount ?? row.ingestFailureCount) as number,
        ingestLastFailureAt: (values.ingestLastFailureAt ?? null) as Date | null,
        ingestNextAttemptAt: (values.ingestNextAttemptAt ?? null) as Date | null,
      };
    });
  }
  return matched.map(({ id }) => ({ id }));
};

const parseOptionalCondition = (condition: SQL | null): ParsedCondition | null => {
  if (condition === null) {
    return null;
  }
  return parseCondition(condition);
};

const applyAccountUpdate = (
  values: Record<string, unknown>,
  condition: SQL | null,
): unknown[] => {
  const parsed = parseOptionalCondition(condition);
  const refreshTokenComparison = parsed?.equalities
    .find(({ table, column }) => table === "oauth_credentials" && column === "refreshToken");
  const matches = parsed === null || conditionMatches(parsed, null);

  state.accountFlagAttempts.push({
    flagged: matches,
    refreshToken: refreshTokenComparison?.value ?? null,
  });

  if (!matches) {
    return [];
  }

  state.account = {
    ...state.account,
    needsReauthentication: values.needsReauthentication === true,
  };
  return [{ id: ACCOUNT_ID }];
};

const applyCredentialUpdate = (values: Record<string, unknown>): unknown[] => {
  state.credential = {
    accessToken: (values.accessToken ?? state.credential.accessToken) as string,
    expiresAt: (values.expiresAt ?? state.credential.expiresAt) as Date,
    refreshToken: (values.refreshToken ?? state.credential.refreshToken) as string,
  };
  return [{ id: OAUTH_CREDENTIAL_ID }];
};

const databaseStub = {
  execute: () => Promise.resolve(),
  select: (columns: Record<string, unknown>) =>
    createChain((condition) => resolveSelect(columns, condition)),
  transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(databaseStub),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => {
      if (table === calendarsTable) {
        return createChain((condition) => applyCalendarUpdate(values, condition));
      }
      if (table === oauthCredentialsTable) {
        return createChain(() => applyCredentialUpdate(values));
      }
      if (table === calendarAccountsTable) {
        return createChain((condition) => applyAccountUpdate(values, condition));
      }
      throw new Error("Unexpected table written by the ingest job");
    },
  }),
};

vi.mock("@/context", () => ({
  database: databaseStub,
  refreshLockRedis: {},
  refreshLockStore: null,
}));

vi.mock("@/env", () => ({
  default: {
    BLOCK_PRIVATE_RESOLUTION: false,
    DATABASE_URL: "postgres://localhost:5432/keeper",
    ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    MICROSOFT_CLIENT_ID: "microsoft-client-id",
    MICROSOFT_CLIENT_SECRET: "microsoft-client-secret",
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

vi.mock("@keeper.sh/calendar/outlook", () => ({
  createOutlookSourceFetcher: () => ({
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
    createMicrosoftTokenRefresher: () => (refreshToken: string) => {
      state.refreshCalls.push(refreshToken);
      return state.refresh().then((outcome) => ({
        access_token: outcome.accessToken,
        expires_in: outcome.expiresInSeconds,
        refresh_token: outcome.refreshToken,
      }));
    },
    ingestSource: (options: { calendarId: string }) => state.runIngest(options.calendarId),
  };
});

const ingestSourcesModule = await import("../../src/jobs/ingest-sources");
const ingestSourcesJob = ingestSourcesModule.default;

const runTick = (): Promise<void> => ingestSourcesJob.callback() as Promise<void>;

const deadRefreshTokenError = (): Error =>
  Object.assign(new Error("Token refresh failed (400): invalid_grant"), {
    oauthReauthRequired: true,
  });

const providerAuthError = (): Error =>
  Object.assign(new Error("Outlook API error (401): InvalidAuthenticationToken"), {
    authRequired: true,
  });

const freshCalendar = (id: string): CalendarRow => ({
  id,
  ingestFailureCount: 0,
  ingestLastFailureAt: null,
  ingestNextAttemptAt: null,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START_AT);
  state.account = {
    id: ACCOUNT_ID,
    needsReauthentication: false,
    oauthCredentialId: OAUTH_CREDENTIAL_ID,
  };
  state.accountFlagAttempts = [];
  state.calendars = [freshCalendar(FIRST_CALENDAR_ID), freshCalendar(SECOND_CALENDAR_ID)];
  state.calendarWrites = [];
  state.credential = {
    accessToken: "access-token-0",
    expiresAt: new Date(START_AT.getTime() - MINUTE_MS),
    refreshToken: "refresh-token-0",
  };
  state.dueCalendarIds = [FIRST_CALENDAR_ID, SECOND_CALENDAR_ID];
  state.refreshCalls = [];
  state.refresh = () => Promise.resolve({
    accessToken: "access-token-1",
    expiresInSeconds: 3600,
    refreshToken: "refresh-token-1",
  });
  state.runIngest = () => Promise.resolve({ eventsAdded: 0, eventsRemoved: 0 });
});

describe("two calendars sharing one dead OAuth credential in a single tick", () => {
  beforeEach(() => {
    state.refresh = () => Promise.reject(deadRefreshTokenError());
  });

  it("refreshes once, backs both calendars off, and flags the account", async () => {
    await runTick();

    expect(state.refreshCalls).toEqual(["refresh-token-0"]);
    expect(state.calendars.map(({ ingestFailureCount }) => ingestFailureCount)).toEqual([1, 1]);
    expect(state.calendars.map(({ ingestNextAttemptAt }) => ingestNextAttemptAt)).toEqual([
      new Date(START_AT.getTime() + 5 * MINUTE_MS),
      new Date(START_AT.getTime() + 5 * MINUTE_MS),
    ]);
    expect(state.account.needsReauthentication).toBe(true);
    expect(state.accountFlagAttempts).not.toHaveLength(0);
    expect(state.accountFlagAttempts.every(({ flagged }) => flagged)).toBe(true);
    expect(state.accountFlagAttempts.every(({ refreshToken }) =>
      refreshToken === null || refreshToken === "refresh-token-0")).toBe(true);
  });

  it("writes each calendar exactly once per tick across repeated ticks", async () => {
    await runTick();
    vi.setSystemTime(new Date(START_AT.getTime() + 5 * MINUTE_MS));
    await runTick();
    vi.setSystemTime(new Date(START_AT.getTime() + 15 * MINUTE_MS));
    await runTick();

    let writesPerCalendar: Record<string, number> = {};
    for (const { id } of state.calendarWrites) {
      writesPerCalendar = { ...writesPerCalendar, [id]: (writesPerCalendar[id] ?? 0) + 1 };
    }
    expect(writesPerCalendar).toEqual({ [FIRST_CALENDAR_ID]: 3, [SECOND_CALENDAR_ID]: 3 });
    expect(state.calendars.map(({ ingestFailureCount }) => ingestFailureCount)).toEqual([3, 3]);
  });
});

describe("a mid-tick reconnect while both calendars are failing", () => {
  beforeEach(() => {
    state.calendars = state.calendars.map((calendar) => ({
      ...calendar,
      ingestFailureCount: 4,
      ingestLastFailureAt: new Date(START_AT.getTime() - 80 * MINUTE_MS),
      ingestNextAttemptAt: new Date(START_AT.getTime() - MINUTE_MS),
    }));
    state.refresh = () => {
      state.credential = {
        accessToken: "reconnected-access-token",
        expiresAt: new Date(START_AT.getTime() + 3_600_000),
        refreshToken: "reconnected-refresh-token",
      };
      state.account = { ...state.account, needsReauthentication: false };
      state.calendars = state.calendars.map((calendar) => ({
        ...calendar,
        ingestFailureCount: 0,
        ingestLastFailureAt: null,
        ingestNextAttemptAt: null,
      }));
      return Promise.reject(deadRefreshTokenError());
    };
  });

  it("leaves the cleared ingest state and the cleared marker alone", async () => {
    await runTick();

    expect(state.calendarWrites).toEqual([]);
    expect(state.calendars.map(({ ingestFailureCount }) => ingestFailureCount)).toEqual([0, 0]);
    expect(state.calendars.map(({ ingestNextAttemptAt }) => ingestNextAttemptAt))
      .toEqual([null, null]);
    expect(state.account.needsReauthentication).toBe(false);
    expect(state.accountFlagAttempts.some(({ flagged }) => flagged)).toBe(false);
  });
});

describe("one calendar losing the refresh race to its sibling", () => {
  it("parks only the loser and lets it converge on the next tick", async () => {
    state.runIngest = (calendarId) => {
      if (calendarId === FIRST_CALENDAR_ID) {
        return Promise.resolve({ eventsAdded: 1, eventsRemoved: 0 });
      }
      state.credential = { ...state.credential, refreshToken: "rotated-by-sibling" };
      return Promise.reject(providerAuthError());
    };
    state.credential = { ...state.credential, expiresAt: new Date(START_AT.getTime() + 3_600_000) };

    await runTick();

    expect(findCalendar(FIRST_CALENDAR_ID).ingestFailureCount).toBe(0);
    expect(findCalendar(SECOND_CALENDAR_ID).ingestFailureCount).toBe(1);
    expect(state.account.needsReauthentication).toBe(false);

    state.runIngest = () => Promise.resolve({ eventsAdded: 0, eventsRemoved: 0 });
    vi.setSystemTime(new Date(START_AT.getTime() + 5 * MINUTE_MS));
    await runTick();

    expect(findCalendar(SECOND_CALENDAR_ID)).toEqual({
      id: SECOND_CALENDAR_ID,
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    });
  });
});

describe("an account with no due calendars", () => {
  it("writes nothing at all", async () => {
    state.dueCalendarIds = [];

    await runTick();

    expect(state.calendarWrites).toEqual([]);
    expect(state.accountFlagAttempts).toEqual([]);
    expect(state.refreshCalls).toEqual([]);
  });
});
