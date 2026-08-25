import { describe, expect, it } from "vitest";
import {
  createEditableEventContentSnapshot,
  hashEditableEventContentSnapshot,
} from "../../src/core/events/content-hash";
import type { EventMapping } from "../../src/core/events/mappings";
import type { PendingChanges } from "../../src/core/sync-engine/types";
import { syncCalendar } from "../../src/core/sync-engine/index";
import type {
  DeleteResult,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../../src/core/types";

const SOURCE_CALENDAR_ID = "source-calendar";
const DESTINATION_CALENDAR_ID = "destination-calendar";
const LOOKUP_FAILURE_MESSAGE = "transient multiget failure";
const PUSH_FAILURE_MESSAGE = "destination refused the write";
const EVENT_COUNT = 60;
const FIRST_CHUNK_SIZE = 50;

const TEST_RECONCILIATION_SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

const buildLocalEvents = (count: number): MaterializedSyncableEvent[] =>
  Array.from({ length: count }, (ignored, index) => ({
    calendarId: SOURCE_CALENDAR_ID,
    calendarName: "Source calendar",
    calendarUrl: null,
    description: `Agenda ${index}`,
    endTime: new Date("2026-05-14T10:00:00.000Z"),
    id: `sync-event-${index}`,
    location: "Meeting room",
    sourceEventUid: `source-uid-${index}`,
    startTime: new Date("2026-05-14T09:00:00.000Z"),
    summary: `Weekly planning ${index}`,
  }));

interface StoredDestinationEvent {
  description: string;
  endTime: Date;
  location: string;
  startTime: Date;
  summary: string;
  uid: string;
}

const toRemoteEvent = (stored: StoredDestinationEvent): RemoteEvent => {
  const content = createEditableEventContentSnapshot({
    description: stored.description,
    location: stored.location,
    summary: stored.summary,
  });

  return {
    deleteId: stored.uid,
    editableAvailability: "busy",
    editableContent: content,
    editableContentHash: hashEditableEventContentSnapshot(content),
    endTime: stored.endTime,
    isKeeperEvent: true,
    startTime: stored.startTime,
    supportedAvailabilities: ["busy", "free"],
    uid: stored.uid,
  };
};

class FlakyCaptureDestination {
  private nextRemoteId = 1;
  private pushCalls = 0;
  private readonly stored = new Map<string, StoredDestinationEvent>();
  public readonly pushedEventIds: string[] = [];
  public readonly deletedIds: string[] = [];
  public failingPushCall: number | null = null;
  public lookupFails = true;
  public lookupAttempts = 0;

  public pushEvents = (events: MaterializedSyncableEvent[]): Promise<PushResult[]> => {
    this.pushCalls += 1;
    if (this.pushCalls === this.failingPushCall) {
      return Promise.reject(new Error(PUSH_FAILURE_MESSAGE));
    }

    return Promise.resolve(events.map((event): PushResult => {
      this.pushedEventIds.push(event.id);
      const uid = `remote-uid-${this.nextRemoteId}`;
      this.nextRemoteId += 1;
      this.stored.set(uid, {
        description: event.description ?? "",
        endTime: event.endTime,
        location: event.location ?? "",
        startTime: event.startTime,
        summary: event.summary,
        uid,
      });
      return { deleteId: uid, remoteId: uid, success: true };
    }));
  };

  public deleteEvents = (deleteIds: string[]): Promise<DeleteResult[]> =>
    Promise.resolve(deleteIds.map((deleteId): DeleteResult => {
      this.deletedIds.push(deleteId);
      this.stored.delete(deleteId);
      return { success: true };
    }));

  public listRemoteEvents = (): Promise<RemoteEvent[]> => Promise.resolve(this.snapshot());

  public getRemoteEventsByIds = (eventIds: string[]): Promise<RemoteEvent[]> => {
    this.lookupAttempts += 1;
    if (this.lookupFails) {
      return Promise.reject(new Error(LOOKUP_FAILURE_MESSAGE));
    }

    const matched: RemoteEvent[] = [];
    for (const eventId of eventIds) {
      const stored = this.stored.get(eventId);
      if (stored) {
        matched.push(toRemoteEvent(stored));
      }
    }
    return Promise.resolve(matched);
  };

  public storedUids = (): string[] => [...this.stored.keys()];

  public snapshot = (): RemoteEvent[] =>
    [...this.stored.values()].map((stored) => toRemoteEvent(stored));

  public resetCalls = (): void => {
    this.pushedEventIds.length = 0;
    this.deletedIds.length = 0;
  };
}

class MappingStore {
  private nextMappingId = 1;
  public readonly mappings = new Map<string, EventMapping>();
  public readonly flushedDeletes: string[] = [];
  public readonly flushedInsertCounts: number[] = [];

  public read = (): EventMapping[] => [...this.mappings.values()];

  public flush = (changes: PendingChanges): Promise<void> => {
    this.flushedInsertCounts.push(changes.inserts.length);

    for (const mappingId of changes.deletes) {
      this.flushedDeletes.push(mappingId);
      this.mappings.delete(mappingId);
    }

    for (const insert of changes.inserts) {
      const mappingId = `mapping-${this.nextMappingId}`;
      this.nextMappingId += 1;
      this.mappings.set(mappingId, { ...insert, id: mappingId });
    }

    for (const update of changes.updates ?? []) {
      const existing = this.mappings.get(update.id);
      if (!existing) {
        continue;
      }
      this.mappings.set(update.id, { ...existing, ...update });
    }

    return Promise.resolve();
  };
}

const reconcile = (
  destination: FlakyCaptureDestination,
  mappingStore: MappingStore,
  localEvents: MaterializedSyncableEvent[],
) =>
  syncCalendar({
    calendarId: DESTINATION_CALENDAR_ID,
    flush: mappingStore.flush,
    isCurrent: () => Promise.resolve(true),
    provider: destination,
    readState: () => Promise.resolve({
      existingMappings: mappingStore.read(),
      localEvents,
      remoteEvents: destination.snapshot(),
    }),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });

describe("a capture failure still never costs a mapping", () => {
  it("writes a mapping row with no recorded form for every event of every chunk", async () => {
    const destination = new FlakyCaptureDestination();
    const mappingStore = new MappingStore();
    const localEvents = buildLocalEvents(EVENT_COUNT);

    await expect(reconcile(destination, mappingStore, localEvents)).resolves.toMatchObject({
      added: EVENT_COUNT,
      addFailed: 0,
      removed: 0,
      removeFailed: 0,
    });

    expect(destination.lookupAttempts).toBeGreaterThanOrEqual(2);
    expect(destination.storedUids()).toHaveLength(EVENT_COUNT);
    expect(mappingStore.read()).toHaveLength(EVENT_COUNT);
    expect(mappingStore.read().map((mapping) => mapping.remoteContentHash ?? null))
      .toEqual(Array.from({ length: EVENT_COUNT }, () => null));
    expect(mappingStore.read().map((mapping) => mapping.destinationEventUid).toSorted())
      .toEqual(destination.storedUids().toSorted());
  });

  it("persists the earlier chunk's mappings even when a later chunk throws", async () => {
    const destination = new FlakyCaptureDestination();
    const mappingStore = new MappingStore();
    const localEvents = buildLocalEvents(EVENT_COUNT);
    destination.failingPushCall = 2;

    await expect(reconcile(destination, mappingStore, localEvents)).rejects.toThrow(
      PUSH_FAILURE_MESSAGE,
    );

    expect(destination.storedUids()).toHaveLength(FIRST_CHUNK_SIZE);
    expect(mappingStore.read()).toHaveLength(FIRST_CHUNK_SIZE);
    expect(mappingStore.read().map((mapping) => mapping.remoteContentHash ?? null))
      .toEqual(Array.from({ length: FIRST_CHUNK_SIZE }, () => null));
    expect(mappingStore.read().map((mapping) => mapping.destinationEventUid).toSorted())
      .toEqual(destination.storedUids().toSorted());
  });

  it("leaves a following healthy reconcile with nothing to delete and nothing to push", async () => {
    const destination = new FlakyCaptureDestination();
    const mappingStore = new MappingStore();
    const localEvents = buildLocalEvents(EVENT_COUNT);

    await reconcile(destination, mappingStore, localEvents);

    destination.lookupFails = false;
    destination.resetCalls();

    await expect(reconcile(destination, mappingStore, localEvents)).resolves.toMatchObject({
      added: 0,
      addFailed: 0,
      removed: 0,
      removeFailed: 0,
    });

    expect(destination.deletedIds).toEqual([]);
    expect(destination.pushedEventIds).toEqual([]);
    expect(mappingStore.flushedDeletes).toEqual([]);
    expect(destination.storedUids()).toHaveLength(EVENT_COUNT);

    const observedHashes = new Map(
      destination.snapshot().map((remote) => [remote.uid, remote.editableContentHash]),
    );
    for (const mapping of mappingStore.read()) {
      expect(mapping.remoteContentHash).toBe(observedHashes.get(mapping.destinationEventUid));
    }
  });
});
