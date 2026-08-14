import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CALENDAR_ID = "1c9a4b70-2e63-4f18-8a52-7d0b3e6c1f94";
const ACCOUNT_ID = "2d0b5c81-3f74-4a29-9b63-8e1c4f7d2a05";
const OAUTH_CREDENTIAL_ID = "3e1c6d92-4a85-4b3a-ac74-9f2d5a8e3b16";
const USER_ID = "4f2d7ea3-5b96-4c4b-bd85-a03e6b9f4c27";
const DEAD_REFRESH_TOKEN = "expired-microsoft-refresh-token";
const START_AT = new Date("2026-08-12T09:00:00.000Z");
const MINUTE_MS = 60_000;

const dialect = new PgDialect();

interface CalendarRow {
  ingestFailureCount: number;
  ingestLastFailureAt: Date | null;
  ingestNextAttemptAt: Date | null;
}

const state: {
  account: { needsReauthentication: boolean; oauthCredentialId: string };
  calendar: CalendarRow;
  flagGuardParams: unknown[][];
  provider: string;
  runIngest: () => Promise<{ eventsAdded: number; eventsRemoved: number }>;
} = {
  account: { needsReauthentication: false, oauthCredentialId: OAUTH_CREDENTIAL_ID },
  calendar: { ingestFailureCount: 0, ingestLastFailureAt: null, ingestNextAttemptAt: null },
  flagGuardParams: [],
  provider: "outlook",
  runIngest: () => Promise.resolve({ eventsAdded: 0, eventsRemoved: 0 }),
};

const oauthSourceRow = () => ({
  accessToken: "stale-access-token",
  accountId: ACCOUNT_ID,
  expiresAt: new Date(START_AT.getTime() + 30 * MINUTE_MS),
  externalCalendarId: "primary",
  ingestFutureRange: "3_months",
  ingestHistoricRange: "1_month",
  ingestWindowEnd: null,
  ingestWindowRecordedAt: null,
  ingestWindowStart: null,
  oauthCredentialId: OAUTH_CREDENTIAL_ID,
  provider: state.provider,
  refreshToken: DEAD_REFRESH_TOKEN,
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
  if ("syncFutureRange" in columns || "url" in columns || "encryptedPassword" in columns) {
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

const applyAccountFlag = (values: Record<string, unknown>, condition: SQL): unknown[] => {
  const query = dialect.sqlToQuery(condition);
  state.flagGuardParams.push(query.params);
  state.account = {
    ...state.account,
    needsReauthentication: values.needsReauthentication === true,
  };
  return [{ id: ACCOUNT_ID }];
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
      if (table !== calendarAccountsTable) {
        throw new Error("Unexpected table written by the ingest job");
      }
      return {
        where: (condition: SQL) => createChain(applyAccountFlag(values, condition)),
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
    ingestSource: () => state.runIngest(),
  };
});

const ingestSourcesModule = await import("../../src/jobs/ingest-sources");
const ingestSourcesJob = ingestSourcesModule.default;

const runTick = (): Promise<unknown> =>
  (ingestSourcesJob.callback() as Promise<void>).catch((error: unknown) => error);

const microsoftDeadRefreshTokenError = (): Error =>
  new Error(
    'Token refresh failed (400): {"error":"invalid_grant","error_description":'
    + '"AADSTS700082: The refresh token has expired due to inactivity."}',
  );

const googleDeadRefreshTokenError = (): Error =>
  Object.assign(new Error("Token refresh failed (400): invalid_grant"), {
    oauthReauthRequired: true,
  });

const resetState = (provider: string): void => {
  vi.useFakeTimers();
  vi.setSystemTime(START_AT);
  state.account = { needsReauthentication: false, oauthCredentialId: OAUTH_CREDENTIAL_ID };
  state.calendar = { ingestFailureCount: 0, ingestLastFailureAt: null, ingestNextAttemptAt: null };
  state.flagGuardParams = [];
  state.provider = provider;
  state.runIngest = () => Promise.resolve({ eventsAdded: 0, eventsRemoved: 0 });
};

describe("an Outlook source whose refresh token expired", () => {
  beforeEach(() => {
    resetState("outlook");
  });

  it("flags the account for reauthentication", async () => {
    state.runIngest = () => Promise.reject(microsoftDeadRefreshTokenError());

    await runTick();

    expect(state.account.needsReauthentication).toBe(true);
  });

  it("does not report the run as a retriable job failure", async () => {
    state.runIngest = () => Promise.reject(microsoftDeadRefreshTokenError());

    expect(await runTick()).toBeUndefined();
  });

  it("still arms the ingest backoff", async () => {
    state.runIngest = () => Promise.reject(microsoftDeadRefreshTokenError());

    await runTick();

    expect(state.calendar.ingestFailureCount).toBe(1);
    expect(state.calendar.ingestNextAttemptAt)
      .toEqual(new Date(START_AT.getTime() + 5 * MINUTE_MS));
  });
});

describe("the same failure on a Google source", () => {
  beforeEach(() => {
    resetState("google");
  });

  it("flags the account and does not fail the job", async () => {
    state.runIngest = () => Promise.reject(googleDeadRefreshTokenError());

    expect(await runTick()).toBeUndefined();
    expect(state.account.needsReauthentication).toBe(true);
    expect(state.flagGuardParams).toHaveLength(1);
  });
});
