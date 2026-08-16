import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DeleteResult,
  EventMapping,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
  RemoteEventListing,
} from "@keeper.sh/calendar";
import { createSyncEventContentHash } from "../../calendar/src/core/events/content-hash";

const resolveSyncProviderMock = vi.fn();
const isCalendarInvalidatedMock = vi.fn(
  (_redis: unknown, _calendarId: string) => Promise.resolve(false),
);
const handleIsCurrentMock = vi.fn(() => Promise.resolve(true));
const acquireMock = vi.fn();
const localEventsMock = vi.fn((): MaterializedSyncableEvent[] => []);
const mappingsMock = vi.fn((): EventMapping[] => []);

const USER_ID = "user-1";
const CALENDAR_ID = "destination-1";
const SOURCE_ID = "source-1";

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    createDatabaseFlush: () => () => Promise.resolve(),
    createGoogleUserRateLimiter: () => null,
    getEventMappingsForDestination: () => Promise.resolve(mappingsMock()),
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
      events: localEventsMock(),
    }),
    getMappedSourceCalendarIds: () => Promise.resolve([SOURCE_ID]),
    getWriteBackPoliciesForDestination: () => Promise.resolve(new Map()),
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

const START = new Date("2026-03-08T00:30:00.000Z");
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

interface CalendarRow {
  failureCount: number;
  lastFailureAt: Date | null;
  nextAttemptAt: Date | null;
}

const makeEvent = (id: string, startTime: Date): MaterializedSyncableEvent => ({
  calendarId: SOURCE_ID,
  calendarName: "Source Calendar",
  calendarUrl: null,
  endTime: new Date(startTime.getTime() + 60 * 60 * 1000),
  id,
  sourceEventUid: `uid-${id}`,
  startTime,
  summary: `Event ${id}`,
});

const makeMapping = (
  id: string,
  event: MaterializedSyncableEvent,
  destinationEventUid: string,
): EventMapping => ({
  calendarId: CALENDAR_ID,
  deleteIdentifier: destinationEventUid,
  destinationEventUid,
  endTime: event.endTime,
  eventStateId: event.id,
  id,
  sourceCalendarId: SOURCE_ID,
  startTime: event.startTime,
  syncEventHash: createSyncEventContentHash(event),
  syncEventId: event.id,
});

const makeRemoteEvent = (uid: string, startTime: Date): RemoteEvent => ({
  deleteId: uid,
  endTime: new Date(startTime.getTime() + 60 * 60 * 1000),
  isKeeperEvent: true,
  startTime,
  uid,
});

const createHarness = (initial: Partial<CalendarRow> = {}) => {
  const row: CalendarRow = {
    failureCount: 0,
    lastFailureAt: null,
    nextAttemptAt: null,
    ...initial,
  };
  const writes: Partial<CalendarRow>[] = [];

  const sourceRow = {
    id: SOURCE_ID,
    ingestFutureRange: "12_months",
    ingestHistoricRange: "1_month",
    ingestWindowEnd: new Date("2100-01-01T00:00:00.000Z"),
    ingestWindowRecordedAt: START,
    ingestWindowStart: new Date("2000-01-01T00:00:00.000Z"),
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
    select: (fields: Record<string, unknown>) => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: () => Promise.resolve([attemptRow()]) }),
        }),
        where: () => {
          if ("ingestWindowStart" in fields) {
            return Promise.resolve([sourceRow]);
          }
          return Promise.resolve([{ calendarId: CALENDAR_ID }]);
        },
      }),
    }),
    update: () => ({
      set: (values: Partial<CalendarRow>) => ({
        where: () => {
          writes.push({ ...values });
          Object.assign(row, values);
          return Promise.resolve();
        },
      }),
    }),
  };

  return { database, row, writes };
};

const config = (database: unknown, overrides: Record<string, unknown> = {}) => ({
  destinationCalendarId: CALENDAR_ID,
  database: database as never,
  redis: {} as never,
  oauthConfig: {} as never,
  plan: "pro" as never,
  ...overrides,
});

const setProvider = (overrides: {
  deleteEvents?: (ids: string[]) => Promise<DeleteResult[]>;
  listRemoteEvents?: () => Promise<RemoteEventListing>;
  pushEvents?: (events: MaterializedSyncableEvent[]) => Promise<PushResult[]>;
}) => {
  const provider = {
    deleteEvents: overrides.deleteEvents
      ?? ((ids: string[]) => Promise.resolve(ids.map(() => ({ success: true })))),
    listRemoteEvents: overrides.listRemoteEvents ?? (() => Promise.resolve({ items: [], rawItemCount: 0 })),
    pushEvents: overrides.pushEvents
      ?? ((events: MaterializedSyncableEvent[]) =>
        Promise.resolve(events.map((_event, index) => ({
          remoteId: `remote-${index}`,
          success: true,
        })))),
  };
  resolveSyncProviderMock.mockImplementation(() => Promise.resolve(provider));
  return provider;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  handleIsCurrentMock.mockImplementation(() => Promise.resolve(true));
  isCalendarInvalidatedMock.mockImplementation(() => Promise.resolve(false));
  localEventsMock.mockImplementation(() => []);
  mappingsMock.mockImplementation(() => []);
  acquireMock.mockImplementation(() => Promise.resolve({
    acquired: true,
    handle: { isCurrent: handleIsCurrentMock, release: () => Promise.resolve() },
  }));
  setProvider({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("the real sync engine driving the destination verdict", () => {
  it("backs off a destination whose every push is rejected by the provider", async () => {
    const { database, row } = createHarness();
    localEventsMock.mockImplementation(() => [
      makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z")),
      makeEvent("ev-2", new Date("2026-03-11T09:00:00.000Z")),
    ]);
    setProvider({
      pushEvents: (events) => Promise.resolve(events.map(() => ({
        error: "rejected",
        success: false,
      }))),
    });

    const result = await syncDestinationsForUser(USER_ID, config(database));

    expect(result.addFailed).toBe(2);
    expect(result.added).toBe(0);
    expect(row.failureCount).toBe(1);
    expect(row.nextAttemptAt).toEqual(new Date(START.getTime() + FIVE_MINUTES_MS));
  });

  it("clears the backoff once the provider starts accepting pushes again", async () => {
    const { database, row } = createHarness({
      failureCount: 4,
      lastFailureAt: new Date(START.getTime() - FIVE_MINUTES_MS),
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    localEventsMock.mockImplementation(() => [
      makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z")),
    ]);

    await syncDestinationsForUser(USER_ID, config(database));

    expect(row).toEqual({ failureCount: 0, lastFailureAt: null, nextAttemptAt: null });
  });

  it("escalates monotonically and saturates at six hours over repeated failing runs", async () => {
    const { database, row } = createHarness();
    localEventsMock.mockImplementation(() => [
      makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z")),
    ]);
    setProvider({
      pushEvents: (events) => Promise.resolve(events.map(() => ({ success: false }))),
    });

    const delays: number[] = [];
    const counts: number[] = [];
    for (let index = 0; index < 12; index++) {
      if (row.nextAttemptAt) {
        vi.setSystemTime(row.nextAttemptAt);
      }
      const attemptedAt = Date.now();
      await syncDestinationsForUser(USER_ID, config(database));
      counts.push(row.failureCount);
      delays.push((row.nextAttemptAt?.getTime() ?? attemptedAt) - attemptedAt);
    }

    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(delays.at(-1)).toBe(SIX_HOURS_MS);
    expect(delays.every((delay, index) => index === 0 || delay >= (delays[index - 1] ?? 0)))
      .toBe(true);
  });

  it("does not attempt the provider again before nextAttemptAt", async () => {
    const { database, row } = createHarness();
    let pushCalls = 0;
    localEventsMock.mockImplementation(() => [
      makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z")),
    ]);
    setProvider({
      pushEvents: (events) => {
        pushCalls += 1;
        return Promise.resolve(events.map(() => ({ success: false })));
      },
    });

    await syncDestinationsForUser(USER_ID, config(database));
    expect(pushCalls).toBe(1);

    vi.setSystemTime(new Date(START.getTime() + FIVE_MINUTES_MS - 1));
    await syncDestinationsForUser(USER_ID, config(database));

    expect(pushCalls).toBe(1);
    expect(row.failureCount).toBe(1);
  });
});

describe("a run that completes after its deadline has passed", () => {
  const inSyncState = () => {
    const startTime = new Date("2026-03-10T09:00:00.000Z");
    const event = makeEvent("ev-1", startTime);
    localEventsMock.mockImplementation(() => [event]);
    mappingsMock.mockImplementation(() => [makeMapping("map-1", event, "remote-1")]);
    setProvider({
      listRemoteEvents: () => Promise.resolve({
        items: [makeRemoteEvent("remote-1", startTime)],
        rawItemCount: 1,
      }),
      pushEvents: () => Promise.reject(new Error("must not push an in-sync destination")),
    });
  };

  it("clears an accumulated backoff when the deadline is crossed after the current check", async () => {
    const { database, row } = createHarness({
      failureCount: 5,
      lastFailureAt: new Date(START.getTime() - 60_000),
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    inSyncState();
    const deadlineMs = START.getTime() + 30_000;

    await syncDestinationsForUser(USER_ID, config(database, { deadlineMs }), {
      onSyncEvent: () => {
        vi.setSystemTime(new Date(deadlineMs + 1));
      },
    });

    expect(row).toEqual({ failureCount: 0, lastFailureAt: null, nextAttemptAt: null });
  });

  it("keeps the accumulated backoff when the deadline was already past at the gate", async () => {
    const { database, row } = createHarness({
      failureCount: 5,
      lastFailureAt: new Date(START.getTime() - 60_000),
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    inSyncState();

    await syncDestinationsForUser(
      USER_ID,
      config(database, { deadlineMs: START.getTime() - 1 }),
    );

    expect(row.failureCount).toBe(5);
    expect(row.nextAttemptAt).toEqual(new Date(START.getTime() - 1));
  });
});

describe("supersession part way through the remote operations", () => {
  const sixtyEvents = () =>
    Array.from({ length: 60 }, (_value, index) =>
      makeEvent(`ev-${index}`, new Date(2026, 2, 10, 9, 0, 0)));

  it("clears the backoff when the first chunk succeeded before the deadline hit", async () => {
    const { database, row } = createHarness({
      failureCount: 3,
      lastFailureAt: new Date(START.getTime() - 60_000),
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    const deadlineMs = START.getTime() + 30_000;
    localEventsMock.mockImplementation(sixtyEvents);
    let pushCalls = 0;
    setProvider({
      pushEvents: (events) => {
        pushCalls += 1;
        vi.setSystemTime(new Date(deadlineMs + 1));
        return Promise.resolve(events.map((_event, index) => ({
          remoteId: `remote-${pushCalls}-${index}`,
          success: true,
        })));
      },
    });

    const result = await syncDestinationsForUser(
      USER_ID,
      config(database, { deadlineMs }),
    );

    expect(pushCalls).toBe(1);
    expect(result.added).toBe(50);
    expect(row).toEqual({ failureCount: 0, lastFailureAt: null, nextAttemptAt: null });
  });

  it("escalates when the only chunk it attempted failed outright", async () => {
    const { database, row } = createHarness({
      failureCount: 2,
      lastFailureAt: new Date(START.getTime() - 60_000),
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    const deadlineMs = START.getTime() + 30_000;
    localEventsMock.mockImplementation(sixtyEvents);
    let pushCalls = 0;
    setProvider({
      pushEvents: (events) => {
        pushCalls += 1;
        vi.setSystemTime(new Date(deadlineMs + 1));
        return Promise.resolve(events.map(() => ({ success: false })));
      },
    });

    const result = await syncDestinationsForUser(
      USER_ID,
      config(database, { deadlineMs }),
    );

    expect(pushCalls).toBe(1);
    expect(result.addFailed).toBe(50);
    expect(row.failureCount).toBe(3);
    expect(row.nextAttemptAt).toEqual(new Date(deadlineMs + 1 + FIVE_MINUTES_MS * 4));
  });
});

describe("a destination that alternates between deadline-truncated and failing runs", () => {
  it("never loses accumulated backoff to a truncated run", async () => {
    const { database, row } = createHarness();
    localEventsMock.mockImplementation(() => [
      makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z")),
    ]);
    setProvider({
      pushEvents: (events) => Promise.resolve(events.map(() => ({ success: false }))),
    });

    const counts: number[] = [];
    for (let index = 0; index < 10; index++) {
      if (row.nextAttemptAt) {
        vi.setSystemTime(row.nextAttemptAt);
      }
      const truncation: Record<string, unknown> = {};
      if (index % 2 === 1) {
        truncation.deadlineMs = Date.now() - 1;
      }
      await syncDestinationsForUser(USER_ID, config(database, truncation));
      counts.push(row.failureCount);
    }

    expect(counts).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
});

describe("recovery from the maximum backoff", () => {
  it("charges the first step again after one successful push clears the counter", async () => {
    const { database, row } = createHarness({
      failureCount: 11,
      lastFailureAt: new Date(START.getTime() - SIX_HOURS_MS),
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    const event = makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z"));
    localEventsMock.mockImplementation(() => [event]);
    let pushSucceeds = true;
    setProvider({
      pushEvents: (events) => Promise.resolve(events.map((_pushed, index) => {
        if (pushSucceeds) {
          return { remoteId: `remote-${index}`, success: true };
        }
        return { success: false };
      })),
    });

    await syncDestinationsForUser(USER_ID, config(database));
    expect(row).toEqual({ failureCount: 0, lastFailureAt: null, nextAttemptAt: null });

    pushSucceeds = false;
    await syncDestinationsForUser(USER_ID, config(database));

    expect(row.failureCount).toBe(1);
    expect(row.nextAttemptAt).toEqual(new Date(START.getTime() + FIVE_MINUTES_MS));
  });
});

describe("a destination whose sources were all unlinked", () => {
  it("removes the orphaned mirrors and clears the backoff, then stays quiet", async () => {
    const { database, row, writes } = createHarness({
      failureCount: 6,
      lastFailureAt: new Date(START.getTime() - 60_000),
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    const orphanStart = new Date("2026-03-10T09:00:00.000Z");
    const remote = [
      makeRemoteEvent("remote-1", orphanStart),
      makeRemoteEvent("remote-2", orphanStart),
    ];
    setProvider({
      deleteEvents: (ids) => {
        for (const id of ids) {
          const index = remote.findIndex((event) => event.deleteId === id);
          if (index !== -1) {
            remote.splice(index, 1);
          }
        }
        return Promise.resolve(ids.map(() => ({ success: true })));
      },
      listRemoteEvents: () => Promise.resolve({ items: [...remote], rawItemCount: remote.length }),
    });

    const first = await syncDestinationsForUser(USER_ID, config(database));
    expect(first.removed).toBe(2);
    expect(row).toEqual({ failureCount: 0, lastFailureAt: null, nextAttemptAt: null });

    const second = await syncDestinationsForUser(USER_ID, config(database));

    expect(second.removed).toBe(0);
    expect(remote).toEqual([]);
    expect(writes).toHaveLength(1);
  });

  it("escalates when every orphan deletion is rejected", async () => {
    const { database, row, writes } = createHarness();
    const orphanStart = new Date("2026-03-10T09:00:00.000Z");
    setProvider({
      deleteEvents: (ids) => Promise.resolve(ids.map(() => ({
        error: "500 provider error",
        success: false,
      }))),
      listRemoteEvents: () => Promise.resolve({
        items: [makeRemoteEvent("remote-1", orphanStart)],
        rawItemCount: 1,
      }),
    });

    await syncDestinationsForUser(USER_ID, config(database));
    expect(writes).toHaveLength(1);
    expect(row.failureCount).toBe(1);

    vi.setSystemTime(row.nextAttemptAt ?? START);
    await syncDestinationsForUser(USER_ID, config(database));

    expect(writes).toHaveLength(2);
    expect(row.failureCount).toBe(2);
  });
});

describe("two workers racing for the same destination", () => {
  it("writes nothing from the worker that could not take the lock", async () => {
    const { database, row, writes } = createHarness({
      failureCount: 3,
      lastFailureAt: new Date(START.getTime() - 60_000),
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    acquireMock.mockImplementation(() => Promise.resolve({ acquired: false }));
    localEventsMock.mockImplementation(() => [
      makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z")),
    ]);

    const result = await syncDestinationsForUser(USER_ID, config(database));

    expect(result.added).toBe(0);
    expect(writes).toEqual([]);
    expect(row.failureCount).toBe(3);
  });

  it("does not announce a backoff it decided not to write when the lock was lost mid-run", async () => {
    const { database, row, writes } = createHarness({
      failureCount: 3,
      lastFailureAt: new Date(START.getTime() - 60_000),
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    let currentChecks = 0;
    handleIsCurrentMock.mockImplementation(() => {
      currentChecks += 1;
      return Promise.resolve(currentChecks === 1);
    });
    localEventsMock.mockImplementation(() => [
      makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z")),
    ]);
    setProvider({
      pushEvents: () => Promise.reject(new Error("Invalid credentials")),
    });
    const reportedErrors: unknown[] = [];

    const result = await syncDestinationsForUser(USER_ID, config(database), {
      onCalendarError: (failure) => {
        reportedErrors.push(failure.error);
      },
    });

    expect(writes).toEqual([]);
    expect(row.failureCount).toBe(3);
    expect({ errors: result.errors, reportedErrors }).toEqual({
      errors: [],
      reportedErrors: [],
    });
  });
});

describe("a reconnect that lands while the run is pushing", () => {
  it("does not stamp a stale backoff over the freshly reconnected calendar", async () => {
    const { database, row } = createHarness({
      failureCount: 6,
      lastFailureAt: new Date(START.getTime() - SIX_HOURS_MS),
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    localEventsMock.mockImplementation(() => [
      makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z")),
    ]);
    setProvider({
      pushEvents: (events) => {
        row.failureCount = 0;
        row.lastFailureAt = null;
        row.nextAttemptAt = null;
        return Promise.resolve(events.map(() => ({
          error: "Invalid credentials",
          success: false,
        })));
      },
    });

    await syncDestinationsForUser(USER_ID, config(database));

    expect(row).toEqual({ failureCount: 0, lastFailureAt: null, nextAttemptAt: null });
  });
});

describe("a deadline that expires exactly at the current instant", () => {
  it("keeps the accumulated backoff rather than clearing it", async () => {
    const { database, row, writes } = createHarness({
      failureCount: 4,
      lastFailureAt: new Date(START.getTime() - 60_000),
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    localEventsMock.mockImplementation(() => [
      makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z")),
    ]);

    await syncDestinationsForUser(
      USER_ID,
      config(database, { deadlineMs: START.getTime() }),
    );

    expect(writes).toEqual([]);
    expect(row.failureCount).toBe(4);
  });
});

describe("a single permanently rejected event", () => {
  it("does not delete and re-create the events that do sync", async () => {
    const { database, row } = createHarness();
    const goodStart = new Date("2026-03-10T09:00:00.000Z");
    const poisonStart = new Date("2026-03-11T09:00:00.000Z");
    const goodEvent = makeEvent("ev-good", goodStart);
    const poisonEvent = makeEvent("ev-poison", poisonStart);
    const mappings: EventMapping[] = [];
    const remote: RemoteEvent[] = [];
    localEventsMock.mockImplementation(() => [goodEvent, poisonEvent]);
    mappingsMock.mockImplementation(() => mappings);
    const deleted: string[] = [];
    setProvider({
      deleteEvents: (ids) => {
        deleted.push(...ids);
        return Promise.resolve(ids.map(() => ({ success: true })));
      },
      listRemoteEvents: () => Promise.resolve({ items: remote, rawItemCount: remote.length }),
      pushEvents: (events) => Promise.resolve(events.map((event) => {
        if (event.id === "ev-poison") {
          return { error: "400 malformed payload", success: false };
        }
        mappings.push(makeMapping("map-good", goodEvent, "remote-good"));
        remote.push(makeRemoteEvent("remote-good", goodStart));
        return { remoteId: "remote-good", success: true };
      })),
    });

    const counts: number[] = [];
    for (let index = 0; index < 4; index++) {
      if (row.nextAttemptAt) {
        vi.setSystemTime(row.nextAttemptAt);
      }
      await syncDestinationsForUser(USER_ID, config(database));
      counts.push(row.failureCount);
    }

    expect(deleted).toEqual([]);
    expect(mappings).toHaveLength(1);
    expect(counts).toEqual([0, 1, 2, 3]);
  });
});
