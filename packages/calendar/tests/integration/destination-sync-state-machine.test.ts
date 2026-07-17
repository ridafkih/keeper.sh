import { describe, expect, it } from "vitest";
import {
  buildEventStateInsertRow,
  ingestSource,
  parseStoredSourceEventStates,
  syncCalendar,
} from "../../src/index";
import type {
  CalendarSyncProvider,
  EventMapping,
  IngestionChanges,
  PendingChanges,
  RemoteEvent,
  SourceEvent,
  StoredSourceEventState,
  SyncableEvent,
} from "../../src/index";
import { createSyncEventContentHash } from "../../src/core/events/content-hash";

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

  public syncableEvents = (): SyncableEvent[] =>
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
    }));
}

class StatefulDestinationProvider implements CalendarSyncProvider {
  public readonly remoteEvents = new Map<string, SyncableEvent>();
  public readonly calls: { deletes: string[][]; pushes: SyncableEvent[][] } = {
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
    }
    return Promise.resolve(eventIds.map(() => ({ success: true })));
  };

  public listRemoteEvents = (): Promise<RemoteEvent[]> => Promise.resolve(
    [...this.remoteEvents.entries()].map(([uid, event]) => ({
      deleteId: uid,
      endTime: event.endTime,
      isKeeperEvent: true,
      startTime: event.startTime,
      uid,
    })),
  );

  public pushEvents = (events: SyncableEvent[]) => {
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
    expect(initialResult).toMatchObject({ added: 1, removed: 0 });
    expect(provider.remoteEvents).toHaveLength(1);
    expect(mappings.mappings).toHaveLength(1);
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
    expect(failedMove).toMatchObject({ added: 0, removeFailed: 1, removed: 0 });
    expect(provider.calls.deletes).toHaveLength(1);
    expect(provider.calls.pushes).toHaveLength(0);
    expect(provider.remoteEvents).toHaveLength(1);
    expect(mappings.mappings).toHaveLength(1);
    expect([...mappings.mappings.values()][0]?.id).toBe(initialMapping?.id);

    provider.resetCalls();
    const retry = await runSync();
    expect(retry).toMatchObject({ added: 1, removeFailed: 0, removed: 1 });
    expect(provider.calls.deletes).toHaveLength(1);
    expect(provider.calls.pushes).toHaveLength(1);
    expect(provider.remoteEvents).toHaveLength(1);
    expect(mappings.mappings).toHaveLength(1);
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
    expect(provider.remoteEvents).toHaveLength(1);
    expect(mappings.mappings).toHaveLength(1);
    expect([...provider.remoteEvents.values()][0]).toMatchObject({
      endTime: MOVED_END,
      startTime: MOVED_START,
    });

    provider.resetCalls();
    await runSync();
    expect(provider.calls).toEqual({ deletes: [], pushes: [] });
  });
});
