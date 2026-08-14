import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CALENDAR_ID = "3f0b6d21-5c8e-4a17-9d3b-1e7c2a9f4d60";
const ACCOUNT_ID = "4a1c7e32-6d9f-4b28-ae4c-2f8d3b0a5e71";
const OAUTH_CREDENTIAL_ID = "5b2d8f43-7e0a-4c39-bf5d-3a9e4c1b6f82";
const CALDAV_CREDENTIAL_ID = "7d4f0a65-9b2c-4e51-8172-5c1a6e3d8b04";
const USER_ID = "6c3e9a54-8f1b-4d40-a06e-4b0f5d2c7a93";
const DEAD_REFRESH_TOKEN = "revoked-refresh-token";
const RECONNECTED_REFRESH_TOKEN = "reconnected-refresh-token";
const START_AT = new Date("2026-08-12T09:00:00.000Z");
const DEAD_ENCRYPTED_PASSWORD = "nonce-a:dead-app-password";
const RECONNECTED_ENCRYPTED_PASSWORD = "nonce-b:reconnected-app-password";
const MINUTE_MS = 60_000;

const dialect = new PgDialect();

interface CalendarRow {
  ingestFailureCount: number;
  ingestLastFailureAt: Date | null;
  ingestNextAttemptAt: Date | null;
}

const state: {
  account: { caldavCredentialId: string; needsReauthentication: boolean; oauthCredentialId: string };
  caldavCredential: { encryptedPassword: string };
  calendar: CalendarRow;
  flagGuardParams: unknown[][];
  oauthCredential: { refreshToken: string };
  sourceKind: "caldav" | "oauth";
  runIngest: () => Promise<{ eventsAdded: number; eventsRemoved: number }>;
} = {
  account: {
    caldavCredentialId: CALDAV_CREDENTIAL_ID,
    needsReauthentication: false,
    oauthCredentialId: OAUTH_CREDENTIAL_ID,
  },
  caldavCredential: { encryptedPassword: DEAD_ENCRYPTED_PASSWORD },
  calendar: {
    ingestFailureCount: 0,
    ingestLastFailureAt: null,
    ingestNextAttemptAt: null,
  },
  flagGuardParams: [],
  oauthCredential: { refreshToken: DEAD_REFRESH_TOKEN },
  sourceKind: "oauth",
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
  provider: "google",
  refreshToken: state.oauthCredential.refreshToken,
  syncToken: null,
  userId: USER_ID,
});

const caldavSourceRow = () => ({
  accountId: ACCOUNT_ID,
  caldavCredentialId: CALDAV_CREDENTIAL_ID,
  calendarUrl: "https://caldav.example.com/calendars/user/home",
  encryptedPassword: state.caldavCredential.encryptedPassword,
  ingestFutureRange: "3_months",
  ingestHistoricRange: "1_month",
  ingestWindowRecordedAt: null,
  provider: "fastmail",
  serverUrl: "https://caldav.example.com",
  userId: USER_ID,
  username: "user@example.com",
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
  if ("url" in columns) {
    return [];
  }
  if ("encryptedPassword" in columns) {
    if (state.sourceKind !== "caldav") {
      return [];
    }
    if ("calendarId" in columns) {
      return [{ ...caldavSourceRow(), calendarId: CALENDAR_ID }];
    }
    return [caldavSourceRow()];
  }
  if (state.sourceKind !== "oauth") {
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
    caldavCredentialId: state.account.caldavCredentialId,
    id: ACCOUNT_ID,
    needsReauthentication: state.account.needsReauthentication,
    oauthCredentialId: state.account.oauthCredentialId,
  },
  caldav_credentials: {
    encryptedPassword: state.caldavCredential.encryptedPassword,
    id: CALDAV_CREDENTIAL_ID,
  },
  oauth_credentials: {
    id: OAUTH_CREDENTIAL_ID,
    refreshToken: state.oauthCredential.refreshToken,
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

const applyAccountFlag = (values: Record<string, unknown>, condition: SQL): unknown[] => {
  const query = dialect.sqlToQuery(condition);
  state.flagGuardParams.push(query.params);

  if (!guardMatchesLiveRows(query.sql, query.params)) {
    return [];
  }

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

vi.mock("@keeper.sh/database", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, decryptPassword: () => "app-password" };
});

vi.mock("@keeper.sh/calendar/google", () => ({
  createGoogleSourceFetcher: () => ({
    fetchEvents: () => Promise.resolve({ events: [] }),
  }),
}));

vi.mock("@keeper.sh/calendar/caldav", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createCalDAVSourceFetcher: () => ({
      fetchEvents: () => Promise.resolve({ events: [] }),
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
    ingestSource: () => state.runIngest(),
  };
});

const ingestSourcesModule = await import("../../src/jobs/ingest-sources");
const ingestSourcesJob = ingestSourcesModule.default;

const runTick = (): Promise<void> => ingestSourcesJob.callback() as Promise<void>;

const deadOAuthCredentialError = (): Error =>
  Object.assign(new Error("Token refresh failed (400): invalid_grant"), {
    oauthReauthRequired: true,
  });

const caldavAuthenticationError = (): Error =>
  Object.assign(new Error("CalDAV request failed with status 401"), {
    status: 401,
  });

const resetState = (sourceKind: "caldav" | "oauth"): void => {
  vi.useFakeTimers();
  vi.setSystemTime(START_AT);
  state.account = {
    caldavCredentialId: CALDAV_CREDENTIAL_ID,
    needsReauthentication: false,
    oauthCredentialId: OAUTH_CREDENTIAL_ID,
  };
  state.caldavCredential = { encryptedPassword: DEAD_ENCRYPTED_PASSWORD };
  state.calendar = {
    ingestFailureCount: 0,
    ingestLastFailureAt: null,
    ingestNextAttemptAt: null,
  };
  state.flagGuardParams = [];
  state.oauthCredential = { refreshToken: DEAD_REFRESH_TOKEN };
  state.sourceKind = sourceKind;
  state.runIngest = () => Promise.resolve({ eventsAdded: 0, eventsRemoved: 0 });
};

describe("an OAuth source with no failure history whose credential dies", () => {
  beforeEach(() => {
    resetState("oauth");
  });

  it("flags the account when nobody reconnected during the run", async () => {
    state.runIngest = () => Promise.reject(deadOAuthCredentialError());

    await runTick();

    expect(state.account.needsReauthentication).toBe(true);
    expect(state.flagGuardParams).toEqual([[
      ACCOUNT_ID,
      OAUTH_CREDENTIAL_ID,
      OAUTH_CREDENTIAL_ID,
      DEAD_REFRESH_TOKEN,
      true,
    ]]);
  });

  it("does not re-raise the marker a mid-run reconnect just cleared", async () => {
    state.runIngest = () => {
      state.oauthCredential = { refreshToken: RECONNECTED_REFRESH_TOKEN };
      state.account = { ...state.account, needsReauthentication: false };
      return Promise.reject(deadOAuthCredentialError());
    };

    await runTick();

    expect(state.account.needsReauthentication).toBe(false);
    expect(state.flagGuardParams).toHaveLength(1);
  });

  it("does not re-raise the marker when the reconnect repointed the account at a new credential", async () => {
    const replacementCredentialId = "9e1b3c07-4d52-4a68-b93f-0a7c2e5d1846";
    state.runIngest = () => {
      state.account = {
        ...state.account,
        needsReauthentication: false,
        oauthCredentialId: replacementCredentialId,
      };
      return Promise.reject(deadOAuthCredentialError());
    };

    await runTick();

    expect(state.account.needsReauthentication).toBe(false);
  });

  it("still arms the backoff for the failing run", async () => {
    state.runIngest = () => {
      state.oauthCredential = { refreshToken: RECONNECTED_REFRESH_TOKEN };
      return Promise.reject(deadOAuthCredentialError());
    };

    await runTick();

    expect(state.calendar.ingestFailureCount).toBe(1);
    expect(state.calendar.ingestNextAttemptAt)
      .toEqual(new Date(START_AT.getTime() + 5 * MINUTE_MS));
  });
});

describe("a CalDAV source with no failure history whose password stopped working", () => {
  beforeEach(() => {
    resetState("caldav");
  });

  it("flags the account when nobody reconnected during the run", async () => {
    state.runIngest = () => Promise.reject(caldavAuthenticationError());

    await runTick();

    expect(state.account.needsReauthentication).toBe(true);
    expect(state.flagGuardParams).toEqual([[
      ACCOUNT_ID,
      CALDAV_CREDENTIAL_ID,
      CALDAV_CREDENTIAL_ID,
      DEAD_ENCRYPTED_PASSWORD,
      true,
    ]]);
  });

  it("does not re-raise the marker a mid-run reconnect just cleared", async () => {
    state.runIngest = () => {
      state.caldavCredential = { encryptedPassword: RECONNECTED_ENCRYPTED_PASSWORD };
      state.account = { ...state.account, needsReauthentication: false };
      return Promise.reject(caldavAuthenticationError());
    };

    await runTick();

    expect(state.account.needsReauthentication).toBe(false);
    expect(state.flagGuardParams).toHaveLength(1);
  });
});
