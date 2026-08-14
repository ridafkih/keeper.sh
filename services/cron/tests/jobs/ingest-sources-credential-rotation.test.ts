import { calendarAccountsTable, calendarsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CALENDAR_ID = "1c9a4e60-8b3d-4f27-9a51-6d0e2b7c4f38";
const ACCOUNT_ID = "2d8b5f71-9c4e-4a38-8b62-7e1f3c8d5a49";
const OAUTH_CREDENTIAL_ID = "3e7c6a82-0d5f-4b49-9c73-8f2a4d9e6b50";
const USER_ID = "4f6d7b93-1e60-4c5a-ad84-902b5eaf7c61";
const START_AT = new Date("2026-08-12T09:00:00.000Z");
const MINUTE_MS = 60_000;
const MAX_BACKOFF_MINUTES = 6 * 60;

const dialect = new PgDialect();

interface CalendarRow {
  ingestFailureCount: number;
  ingestLastFailureAt: Date | null;
  ingestNextAttemptAt: Date | null;
}

interface CredentialRow {
  accessToken: string;
  expiresAt: Date;
  refreshToken: string;
}

interface RefreshOutcome {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken?: string;
}

const state: {
  account: { needsReauthentication: boolean; oauthCredentialId: string };
  accountWrites: { flagged: boolean; needsReauthentication: boolean }[];
  calendar: CalendarRow;
  calendarWrites: CalendarRow[];
  credential: CredentialRow;
  credentialWrites: number;
  flagGuardParams: unknown[][];
  refresh: () => Promise<RefreshOutcome>;
  refreshCalls: string[];
  runIngest: () => Promise<{ eventsAdded: number; eventsRemoved: number }>;
} = {
  account: { needsReauthentication: false, oauthCredentialId: OAUTH_CREDENTIAL_ID },
  accountWrites: [],
  calendar: { ingestFailureCount: 0, ingestLastFailureAt: null, ingestNextAttemptAt: null },
  calendarWrites: [],
  credential: {
    accessToken: "access-token-0",
    expiresAt: new Date(START_AT.getTime() - MINUTE_MS),
    refreshToken: "refresh-token-0",
  },
  credentialWrites: 0,
  flagGuardParams: [],
  refresh: () => Promise.resolve({ accessToken: "access-token-1", expiresInSeconds: 3600 }),
  refreshCalls: [],
  runIngest: () => Promise.resolve({ eventsAdded: 0, eventsRemoved: 0 }),
};

const oauthSourceRow = () => ({
  accountId: ACCOUNT_ID,
  accessToken: state.credential.accessToken,
  expiresAt: state.credential.expiresAt,
  externalCalendarId: "primary",
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

const resolveSelectRows = (columns: Record<string, unknown>): unknown[] => {
  const keys = Object.keys(columns);
  if (keys.length === 1 && keys[0] === "refreshToken") {
    return [{ refreshToken: state.credential.refreshToken }];
  }
  if ("failureCount" in columns) {
    return [{
      failureCount: state.calendar.ingestFailureCount,
      nextAttemptAt: state.calendar.ingestNextAttemptAt,
    }];
  }
  if ("syncFutureRange" in columns) {
    return [];
  }
  if ("url" in columns || "encryptedPassword" in columns) {
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
  state.calendarWrites.push(state.calendar);
};

const liveRows = (): Record<string, Record<string, unknown>> => ({
  calendar_accounts: {
    id: ACCOUNT_ID,
    needsReauthentication: state.account.needsReauthentication,
    oauthCredentialId: state.account.oauthCredentialId,
  },
  oauth_credentials: {
    id: OAUTH_CREDENTIAL_ID,
    refreshToken: state.credential.refreshToken,
  },
});

const isSameValue = (left: unknown, right: unknown): boolean => {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }
  return left === right;
};

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
    const matches = isSameValue(row[column ?? ""], params[Number(index) - 1]);
    if (operator === "<>") {
      return !matches;
    }
    return matches;
  });
};

const applyAccountFlag = (values: Record<string, unknown>, condition: SQL | undefined): unknown[] => {
  const needsReauthentication = values.needsReauthentication === true;

  if (!condition) {
    state.account = { ...state.account, needsReauthentication };
    state.accountWrites.push({ flagged: true, needsReauthentication });
    return [{ id: ACCOUNT_ID }];
  }

  const query = dialect.sqlToQuery(condition);
  state.flagGuardParams.push(query.params);

  if (!guardMatchesLiveRows(query.sql, query.params)) {
    return [];
  }

  state.account = { ...state.account, needsReauthentication };
  state.accountWrites.push({ flagged: true, needsReauthentication });
  return [{ id: ACCOUNT_ID }];
};

const applyCredentialWrite = (values: Record<string, unknown>): void => {
  state.credentialWrites += 1;
  state.credential = {
    accessToken: (values.accessToken ?? state.credential.accessToken) as string,
    expiresAt: (values.expiresAt ?? state.credential.expiresAt) as Date,
    refreshToken: (values.refreshToken ?? state.credential.refreshToken) as string,
  };
};

const databaseStub = {
  execute: () => Promise.resolve(),
  select: (columns: Record<string, unknown>) => createChain(resolveSelectRows(columns)),
  transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(databaseStub),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => {
      if (table === calendarsTable) {
        applyCalendarWrite(values);
        return createChain([{ id: CALENDAR_ID }]);
      }
      if (table === oauthCredentialsTable) {
        applyCredentialWrite(values);
        return createChain([{ id: OAUTH_CREDENTIAL_ID }]);
      }
      if (table !== calendarAccountsTable) {
        throw new Error("Unexpected table written by the ingest job");
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
    ingestSource: () => state.runIngest(),
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

const backoffMinutesFor = (failureCount: number): number =>
  Math.min(5 * 2 ** failureCount, MAX_BACKOFF_MINUTES);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START_AT);
  state.account = { needsReauthentication: false, oauthCredentialId: OAUTH_CREDENTIAL_ID };
  state.accountWrites = [];
  state.calendar = { ingestFailureCount: 0, ingestLastFailureAt: null, ingestNextAttemptAt: null };
  state.calendarWrites = [];
  state.credential = {
    accessToken: "access-token-0",
    expiresAt: new Date(START_AT.getTime() - MINUTE_MS),
    refreshToken: "refresh-token-0",
  };
  state.credentialWrites = 0;
  state.flagGuardParams = [];
  state.refreshCalls = [];
  state.refresh = () => Promise.resolve({
    accessToken: "access-token-1",
    expiresInSeconds: 3600,
    refreshToken: "refresh-token-1",
  });
  state.runIngest = () => Promise.resolve({ eventsAdded: 0, eventsRemoved: 0 });
});

describe("a provider that rotates the refresh token on every refresh", () => {
  it("still flags the account when the fetch fails with a credential error after our own rotation", async () => {
    state.runIngest = () => Promise.reject(providerAuthError());

    await runTick();

    expect(state.refreshCalls).toEqual(["refresh-token-0"]);
    expect(state.credential.refreshToken).toBe("refresh-token-1");
    expect(state.account.needsReauthentication).toBe(true);
    expect(state.flagGuardParams).toEqual([[
      ACCOUNT_ID,
      OAUTH_CREDENTIAL_ID,
      OAUTH_CREDENTIAL_ID,
      "refresh-token-1",
      true,
    ]]);
  });

  it("does not flag when a sibling run rotated the stored token under this stale observation", async () => {
    state.credential = { ...state.credential, expiresAt: new Date(START_AT.getTime() + 3_600_000) };
    state.runIngest = () => {
      state.credential = { ...state.credential, refreshToken: "refresh-token-sibling" };
      return Promise.reject(providerAuthError());
    };

    await runTick();

    expect(state.refreshCalls).toEqual([]);
    expect(state.account.needsReauthentication).toBe(false);
    expect(state.calendar.ingestFailureCount).toBe(1);
  });
});

describe("a dead refresh token left alone across many ticks", () => {
  const runTicksUntilCap = async (tickCount: number): Promise<number[]> => {
    const delays: number[] = [];
    for (let tick = 0; tick < tickCount; tick += 1) {
      const before = state.calendar.ingestNextAttemptAt;
      if (before) {
        vi.setSystemTime(before);
      }
      await runTick();
      const after = state.calendar.ingestNextAttemptAt;
      if (!after) {
        throw new Error("Expected a failing tick to arm the backoff");
      }
      delays.push((after.getTime() - Date.now()) / MINUTE_MS);
    }
    return delays;
  };

  beforeEach(() => {
    state.refresh = () => Promise.reject(deadRefreshTokenError());
  });

  it("climbs to the cap without oscillating and keeps the marker raised", async () => {
    const delays = await runTicksUntilCap(12);

    expect(delays).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((index) => backoffMinutesFor(index)));
    expect(state.calendar.ingestFailureCount).toBe(12);
    expect(state.calendarWrites).toHaveLength(12);
    expect(state.credentialWrites).toBe(0);
    expect(state.credential.refreshToken).toBe("refresh-token-0");
    expect(state.account.needsReauthentication).toBe(true);
    expect(state.accountWrites.every(({ needsReauthentication }) => needsReauthentication))
      .toBe(true);
    expect(state.accountWrites.every(({ flagged }) => flagged)).toBe(true);
  });

  it("does not run again before the armed clock and does not re-arm when skipped", async () => {
    await runTicksUntilCap(3);
    const armedAt = state.calendar.ingestNextAttemptAt;
    const writesBefore = state.calendarWrites.length;
    const refreshesBefore = state.refreshCalls.length;

    vi.setSystemTime(new Date((armedAt?.getTime() ?? 0) - MINUTE_MS));
    await runTick();
    await runTick();

    expect(state.calendarWrites).toHaveLength(writesBefore);
    expect(state.refreshCalls).toHaveLength(refreshesBefore);
    expect(state.calendar.ingestNextAttemptAt).toEqual(armedAt);
  });

  it("treats an attempt clock exactly equal to now as due", async () => {
    await runTicksUntilCap(1);
    const armedAt = state.calendar.ingestNextAttemptAt;
    const writesBefore = state.calendarWrites.length;

    vi.setSystemTime(armedAt ?? START_AT);
    await runTick();

    expect(state.calendarWrites).toHaveLength(writesBefore + 1);
    expect(state.calendar.ingestFailureCount).toBe(2);
  });

  it("resumes immediately after a reconnect and stays converged across later ticks", async () => {
    await runTicksUntilCap(9);
    expect(state.calendar.ingestNextAttemptAt?.getTime())
      .toBe(Date.now() + MAX_BACKOFF_MINUTES * MINUTE_MS);

    const reconnectAt = new Date(Date.now() + MINUTE_MS);
    vi.setSystemTime(reconnectAt);
    state.credential = {
      accessToken: "reconnected-access-token",
      expiresAt: new Date(reconnectAt.getTime() + 3_600_000),
      refreshToken: "reconnected-refresh-token",
    };
    state.account = { ...state.account, needsReauthentication: false };
    state.calendar = {
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    };
    state.calendarWrites = [];
    state.accountWrites = [];
    state.refresh = () => Promise.resolve({
      accessToken: "reconnected-access-token",
      expiresInSeconds: 3600,
      refreshToken: "reconnected-refresh-token",
    });
    state.runIngest = () => Promise.resolve({ eventsAdded: 3, eventsRemoved: 0 });

    await runTick();
    vi.setSystemTime(new Date(reconnectAt.getTime() + MINUTE_MS));
    await runTick();
    vi.setSystemTime(new Date(reconnectAt.getTime() + 2 * MINUTE_MS));
    await runTick();

    expect(state.calendar).toEqual({
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    });
    expect(state.calendarWrites).toEqual([]);
    expect(state.accountWrites).toEqual([]);
    expect(state.account.needsReauthentication).toBe(false);
  });
});
