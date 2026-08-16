import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DeleteResult,
  EventMapping,
  MaterializedSyncableEvent,
  PendingChanges,
  PushResult,
  RemoteEvent,
  RemoteEventListing,
} from "@keeper.sh/calendar";
import { createSyncEventContentHash } from "../../calendar/src/core/events/content-hash";
import { shouldExcludeSyncEvent } from "../../calendar/src/core/events/events";
import { serializeGoogleEvent } from "../../calendar/src/providers/google/destination/serialize-event";

const resolveSyncProviderMock = vi.fn();
const isCalendarInvalidatedMock = vi.fn(
  (_redis: unknown, _calendarId: string) => Promise.resolve(false),
);
const handleIsCurrentMock = vi.fn(() => Promise.resolve(true));
const acquireMock = vi.fn();
const localEventsMock = vi.fn((): MaterializedSyncableEvent[] => []);

const USER_ID = "user-1";
const CALENDAR_ID = "destination-1";
const SOURCE_ID = "source-1";

const mappingStore = new Map<string, EventMapping>();
let mappingSequence = 0;

const applyPendingChanges = (changes: PendingChanges): void => {
  for (const id of changes.deletes) {
    mappingStore.delete(id);
  }
  for (const insert of changes.inserts) {
    mappingSequence += 1;
    const id = `map-${mappingSequence}`;
    mappingStore.set(id, { ...insert, id });
  }
  for (const update of changes.updates ?? []) {
    const existing = mappingStore.get(update.id);
    if (existing) {
      mappingStore.set(update.id, { ...existing, ...update });
    }
  }
};

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    createDatabaseFlush: () => (changes: PendingChanges) => {
      applyPendingChanges(changes);
      return Promise.resolve();
    },
    createGoogleUserRateLimiter: () => null,
    getEventMappingsForDestination: () => Promise.resolve([...mappingStore.values()]),
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
const MINUTE_MS = 60 * 1000;
const FIVE_MINUTES_MS = 5 * MINUTE_MS;
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
  const visibility = { attempt: true };

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
          where: () => ({
            limit: () => {
              if (!visibility.attempt) {
                return Promise.resolve([]);
              }
              return Promise.resolve([attemptRow()]);
            },
          }),
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

  return { database, row, visibility, writes };
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
  mappingStore.clear();
  mappingSequence = 0;
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

const tickForHours = async (
  database: unknown,
  hours: number,
  onTick?: (minute: number) => void,
): Promise<void> => {
  for (let minute = 0; minute < hours * 60; minute++) {
    vi.setSystemTime(new Date(START.getTime() + minute * MINUTE_MS));
    onTick?.(minute);
    await syncDestinationsForUser(USER_ID, config(database));
  }
};

describe("a destination the provider always rejects, driven by the real scheduler cadence", () => {
  it("decays to a handful of attempts a day instead of one a minute", async () => {
    const { database, row } = createHarness();
    localEventsMock.mockImplementation(() => [
      makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z")),
    ]);
    const attemptedAt: number[] = [];
    setProvider({
      pushEvents: (events) => {
        attemptedAt.push(Date.now());
        return Promise.resolve(events.map(() => ({ error: "rejected", success: false })));
      },
    });

    await tickForHours(database, 24);

    expect(attemptedAt.length).toBeLessThanOrEqual(12);
    expect(attemptedAt.length).toBeGreaterThan(0);
    expect(attemptedAt.map((instant) => (instant - START.getTime()) / MINUTE_MS)).toEqual([
      0, 5, 15, 35, 75, 155, 315, 635, 995, 1355,
    ]);
    expect(row.failureCount).toBe(10);
  });

  it("never lets the retry state move backwards across a day of ticks", async () => {
    const { database, row } = createHarness();
    localEventsMock.mockImplementation(() => [
      makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z")),
    ]);
    setProvider({
      pushEvents: (events) =>
        Promise.resolve(events.map(() => ({ error: "rejected", success: false }))),
    });

    let previousFailureCount = 0;
    let previousNextAttempt = 0;
    const regressions: string[] = [];

    await tickForHours(database, 24, () => {
      if (row.failureCount < previousFailureCount) {
        regressions.push(`failureCount ${previousFailureCount} -> ${row.failureCount}`);
      }
      const nextAttempt = row.nextAttemptAt?.getTime() ?? 0;
      if (nextAttempt < previousNextAttempt) {
        regressions.push(`nextAttemptAt ${previousNextAttempt} -> ${nextAttempt}`);
      }
      previousFailureCount = row.failureCount;
      previousNextAttempt = nextAttempt;
    });

    expect(regressions).toEqual([]);
  });

  it("returns to full cadence the moment the provider accepts a push", async () => {
    const { database, row } = createHarness();
    localEventsMock.mockImplementation(() => [
      makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z")),
    ]);
    let healthy = false;
    const attemptedAt: number[] = [];
    const remote = new Map<string, RemoteEvent>();
    setProvider({
      deleteEvents: (ids) => {
        for (const id of ids) {
          remote.delete(id);
        }
        return Promise.resolve(ids.map(() => ({ success: true })));
      },
      listRemoteEvents: () => Promise.resolve({
        items: [...remote.values()],
        rawItemCount: remote.size,
      }),
      pushEvents: (events) => {
        attemptedAt.push(Date.now());
        return Promise.resolve(events.map((event, index) => {
          if (!healthy) {
            return { error: "rejected", success: false };
          }
          const remoteId = `remote-${index}`;
          remote.set(remoteId, makeRemoteEvent(remoteId, event.startTime));
          return { remoteId, success: true };
        }));
      },
    });

    await tickForHours(database, 24);
    expect(row.failureCount).toBe(10);

    healthy = true;
    vi.setSystemTime(row.nextAttemptAt ?? new Date());
    await syncDestinationsForUser(USER_ID, config(database));

    expect(row).toEqual({ failureCount: 0, lastFailureAt: null, nextAttemptAt: null });

    const attemptsAfterHealing = attemptedAt.length;
    const healedAt = Date.now();
    for (let minute = 1; minute <= 3; minute++) {
      vi.setSystemTime(new Date(healedAt + minute * MINUTE_MS));
      await syncDestinationsForUser(USER_ID, config(database));
    }

    expect(attemptedAt.length).toBe(attemptsAfterHealing);
    expect(mappingStore.size).toBe(1);
  });
});

describe("a destination whose every run is cut short by the worker deadline", () => {
  it("neither escalates nor clears, and keeps being attempted", async () => {
    const { database, row, writes } = createHarness({
      failureCount: 2,
      lastFailureAt: new Date(START.getTime() - FIVE_MINUTES_MS * 2),
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    localEventsMock.mockImplementation(() => [
      makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z")),
    ]);
    const pushAttempts: number[] = [];
    setProvider({
      pushEvents: (events) => {
        pushAttempts.push(Date.now());
        return Promise.resolve(events.map((_event, index) => ({
          remoteId: `remote-${index}`,
          success: true,
        })));
      },
    });

    for (let minute = 0; minute < 5; minute++) {
      vi.setSystemTime(new Date(START.getTime() + minute * MINUTE_MS));
      await syncDestinationsForUser(USER_ID, config(database, {
        deadlineMs: Date.now() - 1,
      }));
    }

    expect(writes).toEqual([]);
    expect(row.failureCount).toBe(2);
    expect(pushAttempts).toEqual([]);
  });
});

describe("the backoff schedule across a daylight saving transition", () => {
  it("measures every step in elapsed time, not local wall clock", async () => {
    const { database, row } = createHarness();
    localEventsMock.mockImplementation(() => [
      makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z")),
    ]);
    setProvider({
      pushEvents: (events) =>
        Promise.resolve(events.map(() => ({ error: "rejected", success: false }))),
    });

    const steps: number[] = [];
    for (let index = 0; index < 9; index++) {
      vi.setSystemTime(row.nextAttemptAt ?? new Date());
      const attemptedAt = Date.now();
      await syncDestinationsForUser(USER_ID, config(database));
      steps.push((row.nextAttemptAt?.getTime() ?? 0) - attemptedAt);
    }

    expect(steps).toEqual([
      FIVE_MINUTES_MS,
      FIVE_MINUTES_MS * 2,
      FIVE_MINUTES_MS * 4,
      FIVE_MINUTES_MS * 8,
      FIVE_MINUTES_MS * 16,
      FIVE_MINUTES_MS * 32,
      FIVE_MINUTES_MS * 64,
      SIX_HOURS_MS,
      SIX_HOURS_MS,
    ]);
    expect(row.nextAttemptAt?.toISOString()).toBe("2026-03-08T23:05:00.000Z");
  });
});

describe("a retry row that carries a failure count but no next attempt", () => {
  it("escalates from the stored count rather than restarting the schedule", async () => {
    const { database, row } = createHarness({ failureCount: 3, nextAttemptAt: null });
    localEventsMock.mockImplementation(() => [
      makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z")),
    ]);
    setProvider({
      pushEvents: (events) =>
        Promise.resolve(events.map(() => ({ error: "rejected", success: false }))),
    });

    await syncDestinationsForUser(USER_ID, config(database));

    expect(row.failureCount).toBe(4);
    expect(row.nextAttemptAt).toEqual(new Date(START.getTime() + FIVE_MINUTES_MS * 8));
  });

  it("clears the orphaned count on a healthy run", async () => {
    const { database, row } = createHarness({ failureCount: 3, nextAttemptAt: null });
    localEventsMock.mockImplementation(() => [
      makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z")),
    ]);

    await syncDestinationsForUser(USER_ID, config(database));

    expect(row).toEqual({ failureCount: 0, lastFailureAt: null, nextAttemptAt: null });
  });
});

describe("two runs of the same destination overlapping in flight", () => {
  it("charges the failure once rather than once per run", async () => {
    const { database, row, writes } = createHarness();
    localEventsMock.mockImplementation(() => [
      makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z")),
    ]);

    const { promise: firstPushGate, resolve: releaseFirstPush } = Promise.withResolvers<null>();
    let pushCount = 0;
    setProvider({
      pushEvents: async (events) => {
        pushCount += 1;
        if (pushCount === 1) {
          await firstPushGate;
        }
        return events.map(() => ({ error: "rejected", success: false }));
      },
    });

    const slowRun = syncDestinationsForUser(USER_ID, config(database));
    await Promise.resolve();
    await Promise.resolve();

    await syncDestinationsForUser(USER_ID, config(database));
    expect(row.failureCount).toBe(1);

    releaseFirstPush(null);
    await slowRun;

    expect(row.failureCount).toBe(1);
    expect(writes).toHaveLength(1);
  });
});

describe("a destination that disappears from the eligible set mid-run", () => {
  it("writes nothing when the calendar is disabled between the two reads", async () => {
    const { database, row, visibility, writes } = createHarness({
      failureCount: 4,
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    visibility.attempt = false;

    await syncDestinationsForUser(USER_ID, config(database));

    expect(writes).toEqual([]);
    expect(row.failureCount).toBe(4);
  });

  it("writes nothing when the account can no longer be resolved", async () => {
    const { database, row, writes } = createHarness({
      failureCount: 4,
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    resolveSyncProviderMock.mockImplementation(() => Promise.resolve(null));

    await syncDestinationsForUser(USER_ID, config(database));

    expect(writes).toEqual([]);
    expect(row.failureCount).toBe(4);
  });
});

describe("a run whose only push was accepted without a remote id", () => {
  it("cannot be reached by a working location event, which never leaves the source", () => {
    expect(serializeGoogleEvent(
      { ...makeEvent("ev-1", START), availability: "workingElsewhere" },
      "uid-ev-1",
    )).toBeNull();
    expect(shouldExcludeSyncEvent({
      availability: "workingElsewhere",
      excludeAllDayEvents: false,
      excludeFocusTime: false,
      excludeOutOfOffice: false,
      isAllDay: false,
      sourceEventType: null,
    })).toBe(true);
  });

  it("clears the accumulated backoff on the strength of a successful remote read", async () => {
    const { database, row } = createHarness({
      failureCount: 5,
      lastFailureAt: new Date(START.getTime() - SIX_HOURS_MS),
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    localEventsMock.mockImplementation(() => [
      makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z")),
    ]);
    setProvider({
      pushEvents: (events) => Promise.resolve(events.map(() => ({ success: true }))),
    });

    await syncDestinationsForUser(USER_ID, config(database));

    expect(row).toEqual({ failureCount: 0, lastFailureAt: null, nextAttemptAt: null });
  });

  it("is treated as a run that proved nothing broken, and repeats every cycle", async () => {
    const { database } = createHarness();
    localEventsMock.mockImplementation(() => [
      makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z")),
    ]);
    const pushedIds: string[][] = [];
    setProvider({
      pushEvents: (events) => {
        pushedIds.push(events.map((event) => event.id));
        return Promise.resolve(events.map(() => ({ success: true })));
      },
    });

    for (let minute = 0; minute < 5; minute++) {
      vi.setSystemTime(new Date(START.getTime() + minute * MINUTE_MS));
      await syncDestinationsForUser(USER_ID, config(database));
    }

    expect(pushedIds).toHaveLength(5);
  });
});

describe("a mirror replaced by a push the provider accepts without a remote id", () => {
  it("does not delete the same mirror again on every subsequent run", async () => {
    const { database, row } = createHarness();
    const event = makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z"));
    const staleMapping = {
      ...makeMapping("map-1", event, "remote-1"),
      syncEventHash: "stale-hash",
    };
    mappingStore.set(staleMapping.id, staleMapping);
    localEventsMock.mockImplementation(() => [event]);
    const remote = new Map([["remote-1", makeRemoteEvent("remote-1", event.startTime)]]);
    const deleted: string[] = [];
    const pushed: string[] = [];
    setProvider({
      deleteEvents: (ids) => {
        deleted.push(...ids);
        for (const id of ids) {
          remote.delete(id);
        }
        return Promise.resolve(ids.map(() => ({ success: true })));
      },
      listRemoteEvents: () => Promise.resolve({
        items: [...remote.values()],
        rawItemCount: remote.size,
      }),
      pushEvents: (events) => {
        pushed.push(...events.map((pushedEvent) => pushedEvent.id));
        return Promise.resolve(events.map(() => ({ success: true })));
      },
    });

    for (let minute = 0; minute < 4; minute++) {
      vi.setSystemTime(new Date(START.getTime() + minute * MINUTE_MS));
      await syncDestinationsForUser(USER_ID, config(database));
    }

    expect(deleted).toEqual(["remote-1"]);
    expect(pushed.length).toBeGreaterThan(0);
    expect(row.failureCount).toBe(0);
  });
});

describe("a mirror the provider refuses to delete", () => {
  it("does not re-create the mirror it just failed to remove", async () => {
    const { database } = createHarness();
    const orphan = makeEvent("ev-1", new Date("2026-03-10T09:00:00.000Z"));
    const orphanMapping = makeMapping("map-1", orphan, "remote-1");
    mappingStore.set(orphanMapping.id, orphanMapping);
    localEventsMock.mockImplementation(() => []);
    const pushed: string[] = [];
    setProvider({
      deleteEvents: (ids) => Promise.resolve(ids.map(() => ({
        error: "Forbidden",
        success: false,
      }))),
      listRemoteEvents: () => Promise.resolve({
        items: [makeRemoteEvent("remote-1", orphan.startTime)],
        rawItemCount: 1,
      }),
      pushEvents: (events) => {
        pushed.push(...events.map((event) => event.id));
        return Promise.resolve(events.map((_event, index) => ({
          remoteId: `remote-${index}`,
          success: true,
        })));
      },
    });

    await syncDestinationsForUser(USER_ID, config(database));
    await syncDestinationsForUser(USER_ID, config(database));

    expect(pushed).toEqual([]);
  });
});
