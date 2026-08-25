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
const SMALL_BATCH_SIZE = 3;
const LARGE_BATCH_SIZE = 120;
const OPERATION_CHUNK_SIZE = 50;
const EXPECTED_LARGE_BATCH_CHUNKS = Math.ceil(LARGE_BATCH_SIZE / OPERATION_CHUNK_SIZE);

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

/*
 * A CalDAV-shaped destination: pushEvents never reports a stored hash, so the
 * post-write lookup always fires, and every lookup call costs a multiget on the
 * wire.
 */
class CountingDestination {
  private nextRemoteId = 1;
  private readonly stored = new Map<string, StoredDestinationEvent>();
  public lookupCalls = 0;
  public lookupRequests = 0;
  public lookedUpIdCount = 0;

  public pushEvents = (events: MaterializedSyncableEvent[]): Promise<PushResult[]> =>
    Promise.resolve(events.map((event): PushResult => {
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

  public deleteEvents = (deleteIds: string[]): Promise<DeleteResult[]> =>
    Promise.resolve(deleteIds.map((deleteId): DeleteResult => {
      this.stored.delete(deleteId);
      return { success: true };
    }));

  public listRemoteEvents = (): Promise<RemoteEvent[]> => Promise.resolve(this.snapshot());

  public getRemoteEventsByIds = (eventIds: string[]): Promise<RemoteEvent[]> => {
    this.lookupCalls += 1;
    this.lookupRequests += 2;
    this.lookedUpIdCount += eventIds.length;

    const matched: RemoteEvent[] = [];
    for (const eventId of eventIds) {
      const stored = this.stored.get(eventId);
      if (stored) {
        matched.push(toRemoteEvent(stored));
      }
    }
    return Promise.resolve(matched);
  };

  public snapshot = (): RemoteEvent[] =>
    [...this.stored.values()].map((stored) => toRemoteEvent(stored));
}

/*
 * A Google-shaped destination: the write echoes the provider's own stored form,
 * so no read is owed at all.
 */
class EchoingDestination {
  private readonly stored = new Map<string, StoredDestinationEvent>();
  public lookupCalls = 0;
  public lookupRequests = 0;
  public lookedUpIdCount = 0;

  public pushEvents = (events: MaterializedSyncableEvent[]): Promise<PushResult[]> =>
    Promise.resolve(events.map((event): PushResult => {
      const uid = `echo-uid-${event.id}`;
      const stored: StoredDestinationEvent = {
        description: event.description ?? "",
        endTime: event.endTime,
        location: event.location ?? "",
        startTime: event.startTime,
        summary: event.summary,
        uid,
      };
      this.stored.set(uid, stored);
      return {
        deleteId: uid,
        remoteId: uid,
        storedAvailability: toRemoteEvent(stored).editableAvailability,
        storedContentHash: toRemoteEvent(stored).editableContentHash,
        storedEndTime: stored.endTime,
        storedStartTime: stored.startTime,
        success: true,
      };
    }));

  public deleteEvents = (deleteIds: string[]): Promise<DeleteResult[]> =>
    Promise.resolve(deleteIds.map((deleteId): DeleteResult => {
      this.stored.delete(deleteId);
      return { success: true };
    }));

  public listRemoteEvents = (): Promise<RemoteEvent[]> => Promise.resolve(this.snapshot());

  public getRemoteEventsByIds = (eventIds: string[]): Promise<RemoteEvent[]> => {
    this.lookupCalls += 1;
    this.lookupRequests += 2;
    this.lookedUpIdCount += eventIds.length;

    const matched: RemoteEvent[] = [];
    for (const eventId of eventIds) {
      const stored = this.stored.get(eventId);
      if (stored) {
        matched.push(toRemoteEvent(stored));
      }
    }
    return Promise.resolve(matched);
  };

  public snapshot = (): RemoteEvent[] =>
    [...this.stored.values()].map((stored) => toRemoteEvent(stored));
}

class MappingStore {
  private nextMappingId = 1;
  public readonly mappings = new Map<string, EventMapping>();

  public read = (): EventMapping[] => [...this.mappings.values()];

  public flush = (changes: PendingChanges): Promise<void> => {
    for (const mappingId of changes.deletes) {
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
  destination: CountingDestination | EchoingDestination,
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

describe("capturing the form costs one batched read per chunk", () => {
  it("issues one batched read per chunk for a batch far larger than one chunk", async () => {
    const destination = new CountingDestination();
    const mappingStore = new MappingStore();
    const localEvents = buildLocalEvents(LARGE_BATCH_SIZE);

    await expect(reconcile(destination, mappingStore, localEvents)).resolves.toMatchObject({
      added: LARGE_BATCH_SIZE,
      addFailed: 0,
    });

    expect(destination.lookupCalls).toBe(EXPECTED_LARGE_BATCH_CHUNKS);
    expect(destination.lookedUpIdCount).toBe(LARGE_BATCH_SIZE);
  });

  it("does not scale the read count with the number of events written", async () => {
    const smallDestination = new CountingDestination();
    const largeDestination = new CountingDestination();

    await reconcile(smallDestination, new MappingStore(), buildLocalEvents(SMALL_BATCH_SIZE));
    await reconcile(largeDestination, new MappingStore(), buildLocalEvents(LARGE_BATCH_SIZE));

    expect(smallDestination.lookupCalls).toBe(1);
    expect(largeDestination.lookupCalls).toBe(EXPECTED_LARGE_BATCH_CHUNKS);
    expect(largeDestination.lookupCalls).toBeLessThan(LARGE_BATCH_SIZE);
  });

  it("still records every provider-observed form from those batched reads", async () => {
    const destination = new CountingDestination();
    const mappingStore = new MappingStore();

    await reconcile(destination, mappingStore, buildLocalEvents(LARGE_BATCH_SIZE));

    const hashByUid = new Map(
      destination.snapshot().map((remote) => [remote.uid, remote.editableContentHash]),
    );
    const mappings = mappingStore.read();
    expect(mappings).toHaveLength(LARGE_BATCH_SIZE);
    for (const mapping of mappings) {
      expect(mapping.remoteContentHash).toBe(hashByUid.get(mapping.destinationEventUid));
    }
  });

  it("costs no read at all for a provider that hands the form back on the write", async () => {
    const destination = new EchoingDestination();
    const mappingStore = new MappingStore();

    await reconcile(destination, mappingStore, buildLocalEvents(LARGE_BATCH_SIZE));

    expect(destination.lookupCalls).toBe(0);
    expect(mappingStore.read()).toHaveLength(LARGE_BATCH_SIZE);
  });
});
