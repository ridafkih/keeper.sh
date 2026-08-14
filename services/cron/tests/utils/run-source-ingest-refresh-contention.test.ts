import {
  buildCalendarBackoffState,
  createCoordinatedRefresher,
  ensureValidToken,
  isOAuthReauthRequiredError,
} from "@keeper.sh/calendar";
import type { CalendarBackoffState, TokenState } from "@keeper.sh/calendar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSourceIngest } from "../../src/utils/run-source-ingest";
import type {
  SourceIngestAttempt,
  SourceIngestDependencies,
  SourceIngestLease,
} from "../../src/utils/run-source-ingest";

const CALENDAR_ID = "6b0f3f52-8a58-4f43-9f36-6a7b9a53c1de";
const CREDENTIAL_ID = "7c1a4b63-9b69-4a54-8047-7b8cab64d2ef";
const ACCOUNT_ID = "8d2b5c74-ac7a-4b65-9158-8c9dbc75e3f0";
const MINUTE_MS = 60_000;
const INITIAL_BACKOFF_MS = 5 * MINUTE_MS;
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

interface CredentialRow {
  accessToken: string;
  expiresAt: Date;
  refreshToken: string;
}

interface Fixture {
  accountFlagged: boolean;
  credential: CredentialRow;
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
    rawRefresh: (refreshToken: string) => {
      fixture.rawRefreshCalls += 1;
      if (refreshToken !== fixture.credential.refreshToken) {
        return Promise.reject(
          Object.assign(new Error("invalid_grant: token has been rotated"), {
            oauthReauthRequired: true,
          }),
        );
      }
      return Promise.resolve({
        access_token: "fresh-access-token",
        expires_in: 3600,
        refresh_token: "live-refresh-token",
      });
    },
    refreshLockStore: {
      release: () => Promise.resolve(),
      tryAcquire: () => Promise.resolve(!fixture.lockHeldElsewhere),
    },
  });

const runTick = (calendar: Calendar, fixture: Fixture): Promise<unknown> => {
  const tokenState: TokenState = {
    accessToken: fixture.credential.accessToken,
    accessTokenExpiresAt: fixture.credential.expiresAt,
    refreshToken: fixture.credential.refreshToken,
  };

  return runSourceIngest(
    calendar.dependencies,
    CALENDAR_ID,
    new AbortController().signal,
    async () => {
      await ensureValidToken(tokenState, createRefresher(fixture));
      return { events: 0 };
    },
  ).catch((error: unknown) => error);
};

describe("a healthy OAuth source whose sibling replica is already refreshing the credential", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not classify the coordination error as a credential failure", async () => {
    const fixture = createFixture();
    fixture.lockHeldElsewhere = true;
    const calendar = createCalendar();

    const error = await runTick(calendar, fixture);

    expect(error).toBeInstanceOf(Error);
    expect(isOAuthReauthRequiredError(error)).toBe(false);
    expect(fixture.accountFlagged).toBe(false);
  });

  it("keeps the source due on the next tick instead of parking it behind a backoff", async () => {
    const fixture = createFixture();
    fixture.lockHeldElsewhere = true;
    const calendar = createCalendar();

    await runTick(calendar, fixture);

    expect(calendar.row).toMatchObject({
      ingestFailureCount: 0,
      ingestNextAttemptAt: null,
    });
  });

  it("ingests on the scheduler tick right after the other replica published the token", async () => {
    const fixture = createFixture();
    fixture.lockHeldElsewhere = true;
    const calendar = createCalendar();

    await runTick(calendar, fixture);
    fixture.lockHeldElsewhere = false;
    vi.setSystemTime(new Date(START_AT.getTime() + MINUTE_MS));
    const outcome = await runTick(calendar, fixture);

    expect(outcome).toEqual({ events: 0 });
  });

  it("recovers on the very next tick once the other replica finished the refresh", async () => {
    const fixture = createFixture();
    fixture.lockHeldElsewhere = true;
    const calendar = createCalendar();

    await runTick(calendar, fixture);
    fixture.lockHeldElsewhere = false;
    vi.setSystemTime(new Date(START_AT.getTime() + INITIAL_BACKOFF_MS));
    const outcome = await runTick(calendar, fixture);

    expect(outcome).toEqual({ events: 0 });
    expect(calendar.row).toEqual(cleanRow());
    expect(fixture.credential.accessToken).toBe("fresh-access-token");
  });

  it("refreshes exactly once and never flags the account across a settled account", async () => {
    const fixture = createFixture();
    const calendar = createCalendar();

    await runTick(calendar, fixture);
    await runTick(calendar, fixture);

    expect(fixture.rawRefreshCalls).toBe(1);
    expect(fixture.accountFlagged).toBe(false);
    expect(calendar.row).toEqual(cleanRow());
  });
});
