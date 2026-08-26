import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDestinationAttemptVerdict } from "../src/destination-errors";

/* ------------------------------------------------------------------------------------------------
   Nine of ten edits delivered and one 503 is a working destination, and the counters are the only
   thing that says so: `added` is 0 for every healthy in-place update because all three providers
   answer under the uid the mapping already holds. Two consumers have to see the delivered edits --
   the verdict, or the calendar is escalated toward a six-hour backoff nothing ever undoes, and the
   operator's completion payload, or a run that pushed a hundred edits is byte-identical to one that
   pushed none.
   ------------------------------------------------------------------------------------------------ */

const syncCalendarMock = vi.fn();
const listRemoteEventsMock = vi.fn(() => Promise.resolve([]));
const resolveSyncProviderMock = vi.fn();
const isCalendarInvalidatedMock = vi.fn(
  (_redis: unknown, _calendarId: string) => Promise.resolve(false),
);
const handleIsCurrentMock = vi.fn(() => Promise.resolve(true));
const acquireMock = vi.fn();

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    createDatabaseFlush: () => () => Promise.resolve(),
    createGoogleUserRateLimiter: () => null,
    getEventMappingsForDestination: () => Promise.resolve([]),
    getEventsForCalendarsWithDiagnostics: () => Promise.resolve({
      diagnostics: {
        candidateEventStateCount: 0,
        excludedBySyncPolicyCount: 0,
        materializedEventCount: 0,
        missingSourceEventUidCount: 0,
        outsideReconciliationWindowCount: 0,
        overBudgetSourceEventStateIds: [],
        overBudgetSourceEventUids: [],
        syncableEventCount: 0,
      },
      events: [],
    }),
    getMappedSourceCalendarIds: () => Promise.resolve([]),
    syncCalendar: (options: unknown) => syncCalendarMock(options),
    withSourceIngestLocks: (
      database: unknown,
      _ids: string[],
      run: (database: unknown) => Promise<unknown>,
    ) => run(database),
  };
});

vi.mock("../src/resolve-provider", () => ({
  resolveSyncProvider: (options: unknown) => resolveSyncProviderMock(options),
}));

vi.mock("../src/sync-lock", () => ({
  createMappingMutationLockId: (userId: string) => `mapping:${userId}`,
  createSyncLock: () => ({
    acquire: (calendarId: string, signal: unknown, lockId: string) =>
      acquireMock(calendarId, signal, lockId),
  }),
  isCalendarInvalidated: (redis: unknown, calendarId: string) =>
    isCalendarInvalidatedMock(redis, calendarId),
}));

const { syncDestinationsForUser } = await import("../src/sync-user");

const USER_ID = "user-1";
const CALENDAR_ID = "destination-1";
const START = new Date("2026-03-08T00:30:00.000Z");
const FIVE_MINUTES_MS = 5 * 60 * 1000;

/* The counters the calendar engine really produces for a ten-replace run whose mirrors were all
   present, nine of which the destination accepted in place and one of which answered 503. */
const NINE_OF_TEN_DELIVERED = {
  added: 0,
  addFailed: 1,
  conflictsResolved: 0,
  errors: [],
  removed: 0,
  removeFailed: 0,
  updated: 9,
};

const NOTHING_LANDED = {
  added: 0,
  addFailed: 10,
  conflictsResolved: 0,
  errors: ["push failed"],
  removed: 0,
  removeFailed: 0,
  updated: 0,
};

const NOTHING_ATTEMPTED = {
  added: 0,
  addFailed: 0,
  conflictsResolved: 0,
  errors: [],
  removed: 0,
  removeFailed: 0,
  updated: 0,
};

interface CalendarRow {
  failureCount: number;
  lastFailureAt: Date | null;
  nextAttemptAt: Date | null;
}

const createHarness = (initial: Partial<CalendarRow> = {}) => {
  const row: CalendarRow = {
    failureCount: 0,
    lastFailureAt: null,
    nextAttemptAt: null,
    ...initial,
  };

  const attemptRow = () => ({
    accountId: "account-1",
    calendarId: CALENDAR_ID,
    failureCount: row.failureCount,
    nextAttemptAt: row.nextAttemptAt,
    provider: "google",
    syncFutureRange: "12_months",
    syncHistoricRange: "1_month",
    userId: USER_ID,
  });

  const database = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: () => Promise.resolve([attemptRow()]) }),
        }),
        where: () => Promise.resolve([{ calendarId: CALENDAR_ID }]),
      }),
    }),
    update: () => ({
      set: (values: Partial<CalendarRow>) => ({
        where: () => {
          Object.assign(row, values);
          return Promise.resolve();
        },
      }),
    }),
  };

  return { database, row };
};

const config = (database: unknown) => ({
  destinationCalendarId: CALENDAR_ID,
  database: database as never,
  redis: {} as never,
  oauthConfig: {} as never,
  plan: "pro" as never,
});

const setOutcome = (outcome: Record<string, unknown>) => {
  syncCalendarMock.mockImplementation(async (options: {
    isCurrent: () => Promise<boolean>;
  }) => {
    if (!await options.isCurrent()) {
      return NOTHING_ATTEMPTED;
    }
    return outcome;
  });
};

interface DeliveredEditCount {
  updated?: number;
}

/* Read rather than destructured so a payload that never carries the number reads as absent instead
   of as a run that delivered nothing. */
const readDeliveredEdits = (completion: object): number | undefined =>
  (completion as DeliveredEditCount).updated;

const runAndCaptureCompletion = async (
  database: unknown,
): Promise<Record<string, unknown> | undefined> => {
  const completions: Record<string, unknown>[] = [];
  await syncDestinationsForUser(USER_ID, config(database), {
    onCalendarComplete: (completion) => {
      completions.push(completion as unknown as Record<string, unknown>);
    },
  });
  expect(completions).toHaveLength(1);
  return completions[0];
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  handleIsCurrentMock.mockImplementation(() => Promise.resolve(true));
  isCalendarInvalidatedMock.mockImplementation(() => Promise.resolve(false));
  listRemoteEventsMock.mockImplementation(() => Promise.resolve([]));
  acquireMock.mockImplementation(() => Promise.resolve({
    acquired: true,
    handle: { isCurrent: handleIsCurrentMock, release: () => Promise.resolve() },
  }));
  resolveSyncProviderMock.mockImplementation(() => Promise.resolve({
    listRemoteEvents: listRemoteEventsMock,
  }));
  setOutcome(NINE_OF_TEN_DELIVERED);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("the verdict on a run that delivered edits", () => {
  it("grades nine delivered edits and one refusal as a success", () => {
    expect(resolveDestinationAttemptVerdict(NINE_OF_TEN_DELIVERED, false)).toBe("succeeded");
  });

  it("still grades a run where nothing landed as failed", () => {
    expect(resolveDestinationAttemptVerdict(NOTHING_LANDED, false)).toBe("failed");
  });

  it("still calls a superseded run that attempted nothing inconclusive", () => {
    expect(resolveDestinationAttemptVerdict(NOTHING_ATTEMPTED, true)).toBe("inconclusive");
  });

  it("resets the backoff of a destination whose edits landed", async () => {
    const { database, row } = createHarness({
      failureCount: 4,
      lastFailureAt: START,
      nextAttemptAt: new Date(START.getTime() - 1),
    });

    await syncDestinationsForUser(USER_ID, config(database));

    expect(row).toEqual({ failureCount: 0, lastFailureAt: null, nextAttemptAt: null });
  });

  it("keeps escalating a destination that delivered nothing at all", async () => {
    const { database, row } = createHarness();
    setOutcome(NOTHING_LANDED);

    await syncDestinationsForUser(USER_ID, config(database));

    expect(row.failureCount).toBe(1);
    expect(row.nextAttemptAt).toEqual(new Date(START.getTime() + FIVE_MINUTES_MS));
  });
});

describe("the completion an operator sees", () => {
  /* Without the number here the two runs below are the same report, and the one thing an operator
     needs to know - whether the customer's edits are reaching their calendar - is unanswerable. */
  it("carries the delivered edits into the completion payload", async () => {
    const { database } = createHarness();

    const completion = await runAndCaptureCompletion(database);

    expect(readDeliveredEdits(completion ?? {})).toBe(9);
    // The count of creates stays honest: an in-place edit is not a new mirror on create-only Outlook.
    expect(completion?.["added"]).toBe(0);
    expect(completion?.["addFailed"]).toBe(1);
  });

  it("tells a run that delivered a hundred edits from one that delivered none", async () => {
    const busy = createHarness();
    setOutcome({ ...NINE_OF_TEN_DELIVERED, addFailed: 0, updated: 100 });
    const busyCompletion = await runAndCaptureCompletion(busy.database);

    const idle = createHarness();
    setOutcome(NOTHING_ATTEMPTED);
    const idleCompletion = await runAndCaptureCompletion(idle.database);

    expect(readDeliveredEdits(busyCompletion ?? {})).toBe(100);
    expect(readDeliveredEdits(idleCompletion ?? {})).toBe(0);
  });
});
