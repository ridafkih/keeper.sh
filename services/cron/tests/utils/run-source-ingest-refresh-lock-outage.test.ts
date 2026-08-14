import {
  buildCalendarBackoffState,
  createCoordinatedRefresher,
  ensureValidToken,
  isOAuthRefreshInProgressError,
  isOAuthRefreshLockUnavailableError,
} from "@keeper.sh/calendar";
import type { CalendarBackoffState, TokenState } from "@keeper.sh/calendar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isOAuthRefreshContentionStalled,
  runSourceIngest,
} from "../../src/utils/run-source-ingest";
import type {
  SourceIngestAttempt,
  SourceIngestDependencies,
  SourceIngestLease,
} from "../../src/utils/run-source-ingest";

const ACCOUNT_ID = "8d2b5c74-ac7a-4b65-9158-8c9dbc75e3f0";
const CREDENTIAL_ID = "7c1a4b63-9b69-4a54-8047-7b8cab64d2ef";
const MINUTE_MS = 60_000;
const START_AT = new Date("2026-08-13T09:00:00.000Z");

interface CalendarRow {
  ingestFailureCount: number;
  ingestLastFailureAt: Date | null;
  ingestNextAttemptAt: Date | null;
}

interface Calendar {
  dependencies: SourceIngestDependencies;
  recorded: CalendarBackoffState[];
  row: CalendarRow;
}

const cleanRow = (): CalendarRow => ({
  ingestFailureCount: 0,
  ingestLastFailureAt: null,
  ingestNextAttemptAt: null,
});

const matchesObserved = (row: CalendarRow, observed: SourceIngestAttempt): boolean =>
  row.ingestFailureCount === observed.failureCount
  && (row.ingestNextAttemptAt?.getTime() ?? null) === (observed.nextAttemptAt?.getTime() ?? null);

const createCalendar = (): Calendar => {
  const calendar: Calendar = {
    dependencies: {} as SourceIngestDependencies,
    recorded: [],
    row: cleanRow(),
  };

  calendar.dependencies = {
    acquireLease: (): Promise<SourceIngestLease | null> => Promise.resolve({
      isCurrent: () => Promise.resolve(true),
      release: () => Promise.resolve(),
    }),
    applyBackoff: (_calendarId, observedAttempt) => {
      if (!matchesObserved(calendar.row, observedAttempt)) {
        return Promise.resolve(null);
      }
      const state = buildCalendarBackoffState(observedAttempt.failureCount, new Date());
      calendar.row = {
        ingestFailureCount: state.failureCount,
        ingestLastFailureAt: state.lastFailureAt,
        ingestNextAttemptAt: state.nextAttemptAt,
      };
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
      return Promise.resolve();
    },
  };

  return calendar;
};

interface Fixture {
  accountFlagged: boolean;
  credential: { accessToken: string; expiresAt: Date; refreshToken: string };
  failureHandlerCalls: number;
  lockFailure: Error | null;
  lockHeldElsewhere: boolean;
  rawRefreshCalls: number;
}

const createFixture = (): Fixture => ({
  accountFlagged: false,
  credential: {
    accessToken: "expired-access-token",
    expiresAt: new Date(START_AT.getTime() - MINUTE_MS),
    refreshToken: "live-refresh-token",
  },
  failureHandlerCalls: 0,
  lockFailure: null,
  lockHeldElsewhere: false,
  rawRefreshCalls: 0,
});

const createDatabaseStub = (fixture: Fixture) => ({
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve([{ refreshToken: fixture.credential.refreshToken }]),
      }),
    }),
  }),
  update: () => ({
    set: (values: Record<string, unknown>) => ({
      where: () => {
        if ("needsReauthentication" in values) {
          fixture.accountFlagged = values.needsReauthentication === true;
          return Promise.resolve([]);
        }
        fixture.credential = {
          accessToken: String(values.accessToken),
          expiresAt: values.expiresAt as Date,
          refreshToken: String(values.refreshToken),
        };
        return Promise.resolve([]);
      },
    }),
  }),
});

const createRefresher = (fixture: Fixture) =>
  createCoordinatedRefresher({
    calendarAccountId: ACCOUNT_ID,
    database: createDatabaseStub(fixture) as never,
    oauthCredentialId: CREDENTIAL_ID,
    rawRefresh: () => {
      fixture.rawRefreshCalls += 1;
      return Promise.resolve({
        access_token: "fresh-access-token",
        expires_in: 3600,
        refresh_token: "live-refresh-token",
      });
    },
    refreshLockStore: {
      release: () => Promise.resolve(),
      tryAcquire: () => {
        if (fixture.lockFailure) {
          return Promise.reject(fixture.lockFailure);
        }
        return Promise.resolve(!fixture.lockHeldElsewhere);
      },
    },
  });

const runTick = (
  calendarId: string,
  calendar: Calendar,
  fixture: Fixture,
): Promise<unknown> => {
  const tokenState: TokenState = {
    accessToken: fixture.credential.accessToken,
    accessTokenExpiresAt: fixture.credential.expiresAt,
    refreshToken: fixture.credential.refreshToken,
  };

  return runSourceIngest(
    calendar.dependencies,
    calendarId,
    new AbortController().signal,
    async () => {
      await ensureValidToken(tokenState, createRefresher(fixture));
      return { events: 0 };
    },
    {
      onSettledFailure: () => {
        fixture.failureHandlerCalls += 1;
      },
    },
  ).catch((error: unknown) => error);
};

const redisOutage = (): Error => new Error("Command timed out");

describe("an OAuth source whose refresh lock store is down", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is distinguishable from a lost lock race", async () => {
    const calendarId = "11111111-0000-4000-8000-000000000001";
    const fixture = createFixture();
    fixture.lockFailure = redisOutage();

    const error = await runTick(calendarId, createCalendar(), fixture);

    expect(isOAuthRefreshLockUnavailableError(error)).toBe(true);
    expect(isOAuthRefreshInProgressError(error)).toBe(false);
  });

  it("does not park the source behind a backoff", async () => {
    const calendarId = "11111111-0000-4000-8000-000000000002";
    const fixture = createFixture();
    fixture.lockFailure = redisOutage();
    const calendar = createCalendar();

    await runTick(calendarId, calendar, fixture);

    expect(calendar.row).toEqual(cleanRow());
    expect(calendar.recorded).toEqual([]);
  });

  it("does not run the credential failure handler", async () => {
    const calendarId = "11111111-0000-4000-8000-000000000003";
    const fixture = createFixture();
    fixture.lockFailure = redisOutage();

    await runTick(calendarId, createCalendar(), fixture);

    expect(fixture.failureHandlerCalls).toBe(0);
    expect(fixture.accountFlagged).toBe(false);
  });

  it("syncs on the very next tick once the store recovers", async () => {
    const calendarId = "11111111-0000-4000-8000-000000000004";
    const fixture = createFixture();
    fixture.lockFailure = redisOutage();
    const calendar = createCalendar();

    await runTick(calendarId, calendar, fixture);
    fixture.lockFailure = null;
    vi.setSystemTime(new Date(START_AT.getTime() + MINUTE_MS));

    expect(await runTick(calendarId, calendar, fixture)).toEqual({ events: 0 });
    expect(calendar.row).toEqual(cleanRow());
  });
});

describe("an OAuth source losing the refresh lock race tick after tick", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays a plain skip while the contention is short-lived", async () => {
    const calendarId = "22222222-0000-4000-8000-000000000001";
    const fixture = createFixture();
    fixture.lockHeldElsewhere = true;
    const calendar = createCalendar();

    await runTick(calendarId, calendar, fixture);
    await runTick(calendarId, calendar, fixture);

    expect(isOAuthRefreshContentionStalled(calendarId)).toBe(false);
    expect(calendar.row).toEqual(cleanRow());
  });

  it("reports the stall once the skips stop looking like a lost race", async () => {
    const calendarId = "22222222-0000-4000-8000-000000000002";
    const fixture = createFixture();
    fixture.lockHeldElsewhere = true;
    const calendar = createCalendar();

    for (let tick = 0; tick < 6; tick += 1) {
      await runTick(calendarId, calendar, fixture);
    }

    expect(isOAuthRefreshContentionStalled(calendarId)).toBe(true);
  });

  it("never arms a backoff even once the stall is reported", async () => {
    const calendarId = "22222222-0000-4000-8000-000000000003";
    const fixture = createFixture();
    fixture.lockHeldElsewhere = true;
    const calendar = createCalendar();

    for (let tick = 0; tick < 12; tick += 1) {
      await runTick(calendarId, calendar, fixture);
    }

    expect(calendar.row).toEqual(cleanRow());
    expect(calendar.recorded).toEqual([]);
    expect(fixture.failureHandlerCalls).toBe(0);
  });

  it("forgets the stall as soon as one tick syncs", async () => {
    const calendarId = "22222222-0000-4000-8000-000000000004";
    const fixture = createFixture();
    fixture.lockHeldElsewhere = true;
    const calendar = createCalendar();

    for (let tick = 0; tick < 6; tick += 1) {
      await runTick(calendarId, calendar, fixture);
    }
    fixture.lockHeldElsewhere = false;
    await runTick(calendarId, calendar, fixture);

    expect(isOAuthRefreshContentionStalled(calendarId)).toBe(false);
  });

  it("does not let one source's contention stall another", async () => {
    const stalledCalendarId = "22222222-0000-4000-8000-000000000005";
    const healthyCalendarId = "22222222-0000-4000-8000-000000000006";
    const fixture = createFixture();
    fixture.lockHeldElsewhere = true;
    const calendar = createCalendar();

    for (let tick = 0; tick < 6; tick += 1) {
      await runTick(stalledCalendarId, calendar, fixture);
    }

    expect(isOAuthRefreshContentionStalled(healthyCalendarId)).toBe(false);
  });
});
