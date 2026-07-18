import { describe, expect, it } from "vitest";
import {
  buildEventStateInsertRow,
  ingestSource,
  materializeRecurrenceEvents,
  parseStoredSourceEventStates,
  syncCalendar,
} from "../../src/index";
import type {
  CalendarSyncProvider,
  EventMapping,
  IngestionChanges,
  MaterializedSyncableEvent,
  PendingChanges,
  RemoteEvent,
  SourceEvent,
  StoredSourceEventState,
} from "../../src/index";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
} from "../../src/core/events/content-hash";

const SOURCE_CALENDAR_ID = "source-calendar";
const DESTINATION_CALENDAR_ID = "destination-calendar";
const ORIGINAL_START = new Date("2027-03-08T16:00:00.000Z");
const ORIGINAL_END = new Date("2027-03-08T17:00:00.000Z");
const MOVED_START = new Date("2027-03-08T19:30:00.000Z");
const MOVED_END = new Date("2027-03-08T20:30:00.000Z");

type ScenarioKind = "ordinary event" | "recurring master" | "detached override";

const requireValue = <TValue>(value: TValue | undefined): TValue => {
  if (!value) {
    throw new Error("Expected state-machine value to exist");
  }
  return value;
};

const makeSourceEvent = (
  kind: ScenarioKind,
  startTime: Date,
  endTime: Date,
): SourceEvent => ({
  endTime,
  sourceEventId: `provider-id-${kind}`,
  startTime,
  startTimeZone: "America/Edmonton",
  title: `Adversarial ${kind}`,
  uid: `series-uid-${kind}`,
  ...(kind === "recurring master" && {
    recurrenceRule: { count: 6, frequency: "WEEKLY" },
  }),
  ...(kind === "detached override" && {
    recurrenceId: new Date("2027-03-08T16:00:00.000Z"),
  }),
});

const toStoredRow = (
  id: string,
  event: SourceEvent,
): StoredSourceEventState => {
  const row = buildEventStateInsertRow(SOURCE_CALENDAR_ID, event);
  return {
    availability: row.availability ?? null,
    description: row.description ?? null,
    endTime: row.endTime,
    exceptionDates: row.exceptionDates ?? null,
    id,
    isAllDay: row.isAllDay ?? null,
    location: row.location ?? null,
    recurrenceId: row.recurrenceId ?? null,
    recurrenceRule: row.recurrenceRule ?? null,
    sourceEventId: row.sourceEventId ?? null,
    sourceEventType: row.sourceEventType ?? null,
    sourceEventUid: row.sourceEventUid ?? null,
    startTime: row.startTime,
    startTimeZone: row.startTimeZone ?? null,
    title: row.title ?? null,
  };
};

class InMemoryEventStateStore {
  private nextId = 1;
  public readonly rows = new Map<string, StoredSourceEventState>();

  public read = (): Promise<StoredSourceEventState[]> =>
    Promise.resolve([...this.rows.values()]);

  public flush = (changes: IngestionChanges): Promise<void> => {
    for (const id of changes.deletes) {
      this.rows.delete(id);
    }

    for (const event of changes.inserts) {
      const existing = [...this.rows.values()].find(
        (row) => row.sourceEventId === event.sourceEventId,
      );
      const id = existing?.id ?? `event-state-${this.nextId++}`;
      this.rows.set(id, toStoredRow(id, event));
    }

    return Promise.resolve();
  };

  public syncableEvents = (): MaterializedSyncableEvent[] =>
    materializeRecurrenceEvents(
      parseStoredSourceEventStates([...this.rows.values()]).map((row) => ({
      calendarId: SOURCE_CALENDAR_ID,
      calendarName: "Source calendar",
      calendarUrl: null,
      endTime: row.endTime,
      id: row.id,
      sourceEventUid: row.sourceEventUid ?? "",
      startTime: row.startTime,
      summary: row.title ?? "",
      ...(row.availability === "busy" && { availability: row.availability }),
      ...(row.description && { description: row.description }),
      ...(row.isAllDay !== null && { isAllDay: row.isAllDay }),
      ...(row.location && { location: row.location }),
      ...(row.recurrenceId && { recurrenceId: row.recurrenceId }),
      ...(row.recurrenceRule && { recurrenceRule: row.recurrenceRule }),
      ...(row.startTimeZone && { startTimeZone: row.startTimeZone }),
      })),
      {
        end: new Date("2029-01-01T00:00:00.000Z"),
        start: new Date("2026-01-01T00:00:00.000Z"),
      },
      { retainOneOffEventsAfterWindowEnd: true },
    );
}

class StatefulDestinationProvider implements CalendarSyncProvider {
  public readonly remoteEvents = new Map<string, MaterializedSyncableEvent>();
  public readonly nonKeeperRemoteIds = new Set<string>();
  public readonly calls: {
    deletes: string[][];
    pushes: MaterializedSyncableEvent[][];
  } = {
    deletes: [],
    pushes: [],
  };
  public failNextDelete = false;
  private nextRemoteId = 1;

  public deleteEvents = (eventIds: string[]) => {
    this.calls.deletes.push([...eventIds]);
    if (this.failNextDelete) {
      this.failNextDelete = false;
      return Promise.resolve(eventIds.map(() => ({
        error: "injected destination delete failure",
        success: false,
      })));
    }

    for (const id of eventIds) {
      this.remoteEvents.delete(id);
      this.nonKeeperRemoteIds.delete(id);
    }
    return Promise.resolve(eventIds.map(() => ({ success: true })));
  };

  public listRemoteEvents = (): Promise<RemoteEvent[]> => Promise.resolve(
    [...this.remoteEvents.entries()].map(([uid, event]) => ({
      deleteId: uid,
      endTime: event.endTime,
      isKeeperEvent: !this.nonKeeperRemoteIds.has(uid),
      startTime: event.startTime,
      uid,
    })),
  );

  public pushEvents = (events: MaterializedSyncableEvent[]) => {
    this.calls.pushes.push(events.map((event) => ({ ...event })));
    return Promise.resolve(events.map((event) => {
      const remoteId = `remote-${this.nextRemoteId++}`;
      this.remoteEvents.set(remoteId, { ...event });
      return { deleteId: remoteId, remoteId, success: true };
    }));
  };

  public resetCalls = (): void => {
    this.calls.deletes.length = 0;
    this.calls.pushes.length = 0;
  };

  public seedRemote = (
    remoteId: string,
    event: MaterializedSyncableEvent,
    isKeeperEvent: boolean,
  ): void => {
    this.remoteEvents.set(remoteId, { ...event });
    if (!isKeeperEvent) {
      this.nonKeeperRemoteIds.add(remoteId);
    }
  };
}

class InMemoryMappingStore {
  private nextId = 1;
  public readonly mappings = new Map<string, EventMapping>();

  public flush = (changes: PendingChanges): Promise<void> => {
    for (const id of changes.deletes) {
      this.mappings.delete(id);
    }
    for (const insert of changes.inserts) {
      const mapping: EventMapping = {
        ...insert,
        id: `mapping-${this.nextId++}`,
      };
      this.mappings.set(mapping.id, mapping);
    }
    for (const update of changes.updates ?? []) {
      const mapping = this.mappings.get(update.id);
      if (mapping) {
        this.mappings.set(update.id, { ...mapping, ...update });
      }
    }
    return Promise.resolve();
  };
}

const ingest = async (
  store: InMemoryEventStateStore,
  event: SourceEvent,
): Promise<void> => {
  await ingestSource({
    calendarId: SOURCE_CALENDAR_ID,
    fetchEvents: () => Promise.resolve({ events: [event] }),
    flush: store.flush,
    readExistingEvents: store.read,
  });
};

describe.each<ScenarioKind>([
  "ordinary event",
  "recurring master",
  "detached override",
])("destination synchronization state machine: %s", (kind) => {
  it("never duplicates on delete failure, converges on retry, replays idempotently, and repairs time tampering", async () => {
    const eventStates = new InMemoryEventStateStore();
    const mappings = new InMemoryMappingStore();
    const provider = new StatefulDestinationProvider();
    let expectedEventCount = 1;
    if (kind === "recurring master") {
      expectedEventCount = 6;
    }

    const runSync = () => syncCalendar({
      calendarId: DESTINATION_CALENDAR_ID,
      flush: mappings.flush,
      isCurrent: () => Promise.resolve(true),
      provider,
      readState: async () => ({
        existingMappings: [...mappings.mappings.values()],
        localEvents: eventStates.syncableEvents(),
        remoteEvents: await provider.listRemoteEvents(),
      }),
      userId: "user-1",
    });

    await ingest(eventStates, makeSourceEvent(kind, ORIGINAL_START, ORIGINAL_END));
    const [originalEventStateId] = [...eventStates.rows.keys()];
    expect(originalEventStateId).toBeDefined();

    const initialResult = await runSync();
    expect(initialResult).toMatchObject({ added: expectedEventCount, removed: 0 });
    expect(provider.remoteEvents).toHaveLength(expectedEventCount);
    expect(mappings.mappings).toHaveLength(expectedEventCount);
    const [initialMapping] = [...mappings.mappings.values()];
    const [initialLocalEvent] = eventStates.syncableEvents();
    expect(initialMapping?.eventStateId).toBe(originalEventStateId);
    expect(initialMapping?.syncEventHash).toBe(
      createSyncEventContentHash(requireValue(initialLocalEvent)),
    );

    await ingest(eventStates, makeSourceEvent(kind, MOVED_START, MOVED_END));
    expect([...eventStates.rows.keys()]).toEqual([originalEventStateId]);
    expect(eventStates.syncableEvents()[0]?.startTime).toEqual(MOVED_START);

    provider.resetCalls();
    provider.failNextDelete = true;
    const failedMove = await runSync();
    expect(failedMove).toMatchObject({
      added: 0,
      removeFailed: expectedEventCount,
      removed: 0,
    });
    expect(provider.calls.deletes).toHaveLength(1);
    expect(provider.calls.pushes).toHaveLength(0);
    expect(provider.remoteEvents).toHaveLength(expectedEventCount);
    expect(mappings.mappings).toHaveLength(expectedEventCount);
    expect([...mappings.mappings.values()][0]?.id).toBe(initialMapping?.id);

    provider.resetCalls();
    const retry = await runSync();
    expect(retry).toMatchObject({
      added: expectedEventCount,
      removeFailed: 0,
      removed: expectedEventCount,
    });
    expect(provider.calls.deletes).toHaveLength(1);
    expect(provider.calls.pushes).toHaveLength(1);
    expect(provider.remoteEvents).toHaveLength(expectedEventCount);
    expect(mappings.mappings).toHaveLength(expectedEventCount);
    expect([...provider.remoteEvents.values()][0]?.startTime).toEqual(MOVED_START);
    expect([...mappings.mappings.values()][0]?.eventStateId).toBe(originalEventStateId);

    provider.resetCalls();
    const replay = await runSync();
    expect(replay).toMatchObject({ added: 0, removed: 0 });
    expect(provider.calls).toEqual({ deletes: [], pushes: [] });

    const [remoteId, remoteEvent] = requireValue([...provider.remoteEvents.entries()][0]);
    provider.remoteEvents.set(remoteId, {
      ...remoteEvent,
      endTime: new Date("2027-03-08T23:00:00.000Z"),
      startTime: new Date("2027-03-08T22:00:00.000Z"),
    });
    provider.resetCalls();

    const tamperRepair = await runSync();
    expect(tamperRepair).toMatchObject({ added: 1, removed: 1 });
    expect(provider.calls.deletes).toHaveLength(1);
    expect(provider.calls.pushes).toHaveLength(1);
    expect(provider.remoteEvents).toHaveLength(expectedEventCount);
    expect(mappings.mappings).toHaveLength(expectedEventCount);
    expect([...provider.remoteEvents.values()].some((event) =>
      event.startTime.getTime() === MOVED_START.getTime()
      && event.endTime.getTime() === MOVED_END.getTime()
    )).toBe(true);

    provider.resetCalls();
    await runSync();
    expect(provider.calls).toEqual({ deletes: [], pushes: [] });
  });
});

it("repairs far-future Keeper orphans, retains user events, and converges", async () => {
  const eventStates = new InMemoryEventStateStore();
  const mappings = new InMemoryMappingStore();
  const provider = new StatefulDestinationProvider();
  const farFutureEvent = makeSourceEvent(
    "ordinary event",
    new Date("2040-03-15T09:00:00.000Z"),
    new Date("2040-03-15T10:00:00.000Z"),
  );
  const runSync = () => syncCalendar({
    calendarId: DESTINATION_CALENDAR_ID,
    flush: mappings.flush,
    isCurrent: () => Promise.resolve(true),
    provider,
    readState: async () => ({
      existingMappings: [...mappings.mappings.values()],
      localEvents: eventStates.syncableEvents(),
      remoteEvents: await provider.listRemoteEvents(),
    }),
    timeBoundary: {
      syncWindowStart: new Date("2026-07-10T00:00:00.000Z"),
    },
    userId: "user-1",
  });

  await ingest(eventStates, farFutureEvent);
  await expect(runSync()).resolves.toMatchObject({ added: 1, removed: 0 });
  const desiredEvent = requireValue(eventStates.syncableEvents()[0]);
  provider.seedRemote("orphaned-keeper-copy", desiredEvent, true);
  provider.seedRemote("user-owned-event", desiredEvent, false);
  provider.resetCalls();

  await expect(runSync()).resolves.toMatchObject({ added: 0, removed: 1 });
  expect(provider.remoteEvents.has("orphaned-keeper-copy")).toBe(false);
  expect(provider.remoteEvents.has("user-owned-event")).toBe(true);

  provider.resetCalls();
  await expect(runSync()).resolves.toMatchObject({ added: 0, removed: 0 });
  expect(provider.calls).toEqual({ deletes: [], pushes: [] });
});

it("migrates a legacy recurring Google mapping in place and converges", async () => {
  const occurrence: MaterializedSyncableEvent = {
    calendarId: SOURCE_CALENDAR_ID,
    calendarName: "Source calendar",
    calendarUrl: null,
    endTime: new Date("2027-03-08T17:00:00.000Z"),
    eventStateId: "recurring-master-state",
    id: "materialized-occurrence",
    sourceEventUid: "legacy-series",
    startTime: new Date("2027-03-08T16:00:00.000Z"),
    summary: "Legacy recurring occurrence",
  };
  const legacyUid = "legacy-google-occurrence@keeper.sh";
  const providerEventId = "google-provider-event-id";
  const mappings = new InMemoryMappingStore();
  mappings.mappings.set("legacy-mapping", {
    calendarId: DESTINATION_CALENDAR_ID,
    deleteIdentifier: legacyUid,
    destinationEventUid: legacyUid,
    endTime: occurrence.endTime,
    eventStateId: "recurring-master-state",
    id: "legacy-mapping",
    startTime: occurrence.startTime,
    syncEventHash: "legacy-master-hash",
    syncEventId: occurrence.eventStateId,
  });
  const remoteEvent: RemoteEvent = {
    deleteId: providerEventId,
    editableAvailability: "busy",
    editableContentHash: createEditableEventContentHash(occurrence),
    endTime: occurrence.endTime,
    isKeeperEvent: true,
    startTime: occurrence.startTime,
    uid: legacyUid,
  };
  const remoteWrites = { deletes: 0, pushes: 0 };
  const provider: CalendarSyncProvider = {
    deleteEvents: (ids) => {
      remoteWrites.deletes += ids.length;
      return Promise.resolve(ids.map(() => ({ success: true })));
    },
    listRemoteEvents: () => Promise.resolve([remoteEvent]),
    pushEvents: (events) => {
      remoteWrites.pushes += events.length;
      return Promise.resolve(events.map(() => ({ success: true })));
    },
  };
  const runSync = () => syncCalendar({
    calendarId: DESTINATION_CALENDAR_ID,
    flush: mappings.flush,
    isCurrent: () => Promise.resolve(true),
    provider,
    readState: () => Promise.resolve({
      existingMappings: [...mappings.mappings.values()],
      localEvents: [occurrence],
      remoteEvents: [remoteEvent],
    }),
    userId: "user-1",
  });

  await expect(runSync()).resolves.toMatchObject({ added: 0, removed: 0 });
  expect([...mappings.mappings.values()][0]).toMatchObject({
    deleteIdentifier: providerEventId,
    syncEventHash: createSyncEventContentHash(occurrence),
    syncEventId: occurrence.id,
  });
  expect(remoteWrites).toEqual({ deletes: 0, pushes: 0 });

  await expect(runSync()).resolves.toMatchObject({ added: 0, removed: 0 });
  expect(remoteWrites).toEqual({ deletes: 0, pushes: 0 });
});

it("prunes an expired recurrence mapping without deleting history when the window advances", async () => {
  const mappings = new InMemoryMappingStore();
  const provider = new StatefulDestinationProvider();
  const expiredOccurrence: MaterializedSyncableEvent = {
    calendarId: SOURCE_CALENDAR_ID,
    calendarName: "Source calendar",
    calendarUrl: null,
    endTime: new Date("2027-03-01T15:00:00.000Z"),
    eventStateId: "recurring-master-state",
    id: "recurrence-expired",
    sourceEventUid: "sliding-window-series",
    startTime: new Date("2027-03-01T14:00:00.000Z"),
    summary: "Sliding window series",
  };
  const enteringOccurrence: MaterializedSyncableEvent = {
    ...expiredOccurrence,
    endTime: new Date("2029-03-01T15:00:00.000Z"),
    id: "recurrence-entering",
    startTime: new Date("2029-03-01T14:00:00.000Z"),
  };
  let localEvents = [expiredOccurrence];
  let syncWindowStart = new Date("2027-02-22T00:00:00.000Z");

  const runSync = () => syncCalendar({
    calendarId: DESTINATION_CALENDAR_ID,
    flush: mappings.flush,
    isCurrent: () => Promise.resolve(true),
    provider,
    readState: async () => {
      const remoteEvents = await provider.listRemoteEvents();
      return {
        existingMappings: [...mappings.mappings.values()],
        localEvents,
        remoteEvents: remoteEvents.filter((event) => event.endTime >= syncWindowStart),
      };
    },
    timeBoundary: { syncWindowStart },
    userId: "user-1",
  });

  await expect(runSync()).resolves.toMatchObject({ added: 1, removed: 0 });
  expect(provider.remoteEvents).toHaveLength(1);
  expect(mappings.mappings).toHaveLength(1);
  const historicalRemoteId = requireValue([...provider.remoteEvents.keys()][0]);

  localEvents = [enteringOccurrence];
  syncWindowStart = new Date("2027-03-08T00:00:00.000Z");
  provider.resetCalls();

  await expect(runSync()).resolves.toMatchObject({ added: 1, removed: 0 });
  expect(provider.calls.deletes).toEqual([]);
  expect(provider.calls.pushes).toHaveLength(1);
  expect(provider.remoteEvents).toHaveLength(2);
  expect(provider.remoteEvents.has(historicalRemoteId)).toBe(true);
  expect(mappings.mappings).toHaveLength(1);
  expect([...mappings.mappings.values()][0]?.syncEventId).toBe(enteringOccurrence.id);

  provider.resetCalls();
  await expect(runSync()).resolves.toMatchObject({ added: 0, removed: 0 });
  expect(provider.calls).toEqual({ deletes: [], pushes: [] });
  expect(provider.remoteEvents).toHaveLength(2);
});
