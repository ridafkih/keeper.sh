import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CALENDAR_ID_PREFIX = "5a3e8fb4-6ca7-4d5c-be96-b14f7cae5d";
const ACCOUNT_ID = "6b4f9ac5-7db8-4e6d-cfa7-c25a8dbf6e49";
const OAUTH_CREDENTIAL_ID = "7c5aab06-8ec9-4f7e-daa8-d36b9eca7f5a";
const USER_ID = "8d6bbc17-9fda-4a8f-ebb9-e47cafdb8a6b";
const START_AT = new Date("2026-08-13T09:00:00.000Z");
const MINUTE_MS = 60_000;

interface CalendarRow {
  ingestFailureCount: number;
  ingestLastFailureAt: Date | null;
  ingestNextAttemptAt: Date | null;
}

interface ErrorField {
  error: unknown;
  fields: Record<string, unknown>;
}

const state: {
  account: { needsReauthentication: boolean };
  calendar: CalendarRow;
  calendarId: string;
  errorFields: ErrorField[];
  events: Record<string, unknown>[];
  fields: Record<string, unknown>;
  lockFailure: Error | null;
  lockHeldElsewhere: boolean;
  rawRefreshCalls: number;
} = {
  account: { needsReauthentication: false },
  calendar: { ingestFailureCount: 0, ingestLastFailureAt: null, ingestNextAttemptAt: null },
  calendarId: `${CALENDAR_ID_PREFIX}00`,
  errorFields: [],
  events: [],
  fields: {},
  lockFailure: null,
  lockHeldElsewhere: false,
  rawRefreshCalls: 0,
};

const sourceEvent = (): Record<string, unknown> => {
  const events = state.events.filter((event) =>
    event["provider.calendar_id"] === state.calendarId);
  const [event] = events.slice(-1);
  if (!event) {
    throw new Error(`No wide event was flushed for the source, saw ${JSON.stringify(state.events)}`);
  }
  return event;
};

const oauthSourceRow = () => ({
  accessToken: "expired-access-token",
  accountId: ACCOUNT_ID,
  expiresAt: new Date(START_AT.getTime() - MINUTE_MS),
  externalCalendarId: "primary",
  ingestFutureRange: "3_months",
  ingestHistoricRange: "1_month",
  ingestWindowEnd: null,
  ingestWindowRecordedAt: null,
  ingestWindowStart: null,
  oauthCredentialId: OAUTH_CREDENTIAL_ID,
  provider: "outlook",
  refreshToken: "live-refresh-token",
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
  if ("refreshToken" in columns && Object.keys(columns).length === 1) {
    return [{ refreshToken: "live-refresh-token" }];
  }
  if ("calendarId" in columns) {
    return [{ ...oauthSourceRow(), calendarId: state.calendarId }];
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

const databaseStub = {
  execute: () => Promise.resolve(),
  select: (columns: Record<string, unknown>) => createChain(resolveSelectRows(columns)),
  transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(databaseStub),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => {
      if (table === calendarsTable) {
        applyCalendarWrite(values);
        return createChain([{ id: state.calendarId }]);
      }
      if (table !== calendarAccountsTable) {
        throw new Error("Unexpected table written by the ingest job");
      }
      state.account = { needsReauthentication: values.needsReauthentication === true };
      return {
        where: () => createChain([{ id: ACCOUNT_ID }]),
      };
    },
  }),
};

vi.mock("@/context", () => ({
  database: databaseStub,
  refreshLockRedis: {},
  refreshLockStore: {
    release: () => Promise.resolve(),
    tryAcquire: () => {
      if (state.lockFailure) {
        return Promise.reject(state.lockFailure);
      }
      return Promise.resolve(!state.lockHeldElsewhere);
    },
  },
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
    errorFields: (error: unknown, fields: Record<string, unknown>) => {
      state.errorFields.push({ error, fields });
    },
    flush: () => {
      state.events = [...state.events, state.fields];
      state.fields = {};
    },
    set: (key: string, value: unknown) => {
      state.fields = { ...state.fields, [key]: value };
    },
    time: {
      measure: (_name: string, callback: () => Promise<unknown>) => callback(),
    },
  },
}));

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createMicrosoftTokenRefresher: () => () => {
      state.rawRefreshCalls += 1;
      return Promise.resolve({
        access_token: "fresh-access-token",
        expires_in: 3600,
        refresh_token: "live-refresh-token",
      });
    },
    ingestSource: () => Promise.resolve({ eventsAdded: 0, eventsRemoved: 0 }),
  };
});

const ingestSourcesModule = await import("../../src/jobs/ingest-sources");
const ingestSourcesJob = ingestSourcesModule.default;

const runTick = (): Promise<unknown> =>
  (ingestSourcesJob.callback() as Promise<void>).catch((error: unknown) => error);

let calendarSequence = 0;

const resetState = (): void => {
  vi.useFakeTimers();
  vi.setSystemTime(START_AT);
  calendarSequence += 1;
  state.account = { needsReauthentication: false };
  state.calendarId = `${CALENDAR_ID_PREFIX}${String(calendarSequence).padStart(2, "0")}`;
  state.calendar = { ingestFailureCount: 0, ingestLastFailureAt: null, ingestNextAttemptAt: null };
  state.errorFields = [];
  state.events = [];
  state.fields = {};
  state.lockFailure = null;
  state.lockHeldElsewhere = false;
  state.rawRefreshCalls = 0;
};

describe("the ingest tick while the refresh lock store is unreachable", () => {
  beforeEach(() => {
    resetState();
  });

  it("records the outage as an error rather than a silent skip", async () => {
    state.lockFailure = new Error("Command timed out");

    await runTick();

    expect(sourceEvent().outcome).toBe("error");
    expect(sourceEvent()["skip.reason"]).toBeUndefined();
  });

  it("names the outage with its own error slug", async () => {
    state.lockFailure = new Error("Command timed out");

    await runTick();

    expect(state.errorFields.map((entry) => entry.fields.slug))
      .toContain("oauth-refresh-lock-unavailable");
  });

  it("leaves the source due and unflagged so it resumes when the store returns", async () => {
    state.lockFailure = new Error("Command timed out");

    await runTick();

    expect(state.calendar).toEqual({
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    });
    expect(state.account.needsReauthentication).toBe(false);
    expect(state.rawRefreshCalls).toBe(0);
  });
});

describe("the ingest tick while another replica holds the refresh lock", () => {
  beforeEach(() => {
    resetState();
  });

  it("stays a cheap skip on the first contended tick", async () => {
    state.lockHeldElsewhere = true;

    await runTick();

    expect(sourceEvent().outcome).toBe("skipped");
    expect(sourceEvent()["skip.reason"]).toBe("oauth-refresh-in-progress");
    expect(state.calendar.ingestFailureCount).toBe(0);
  });

  it("stops skipping silently once the contention never clears", async () => {
    state.lockHeldElsewhere = true;

    for (let tick = 0; tick < 6; tick += 1) {
      await runTick();
    }

    expect(sourceEvent().outcome).toBe("error");
    expect(state.errorFields.map((entry) => entry.fields.slug))
      .toContain("oauth-refresh-contention-stalled");
    expect(state.calendar.ingestFailureCount).toBe(0);
    expect(state.account.needsReauthentication).toBe(false);
  });
});
