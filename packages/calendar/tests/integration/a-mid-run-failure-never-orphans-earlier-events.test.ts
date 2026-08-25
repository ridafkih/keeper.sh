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

/*
 * A CalDAV-shaped destination whose second push of a run rejects the way an
 * aborted deadline or a refused token does: the writes already accepted stay
 * on the destination, and the throw escapes the run.
 */
class HalfFailingDestination {
  private nextRemoteId = 1;
  private pushCalls = 0;
  private readonly stored = new Map<string, StoredDestinationEvent>();
  public failingPushCall: number | null = 2;
  public deletedIds: string[] = [];

  public pushEvents = (events: MaterializedSyncableEvent[]): Promise<PushResult[]> => {
    this.pushCalls += 1;
    if (this.pushCalls === this.failingPushCall) {
      return Promise.reject(new Error("destination refused the write"));
    }

    return Promise.resolve(events.map((event): PushResult => {
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
}

class MappingStore {
  private nextMappingId = 1;
  public readonly mappings = new Map<string, EventMapping>();
  public readonly flushedDeletes: string[] = [];

  public read = (): EventMapping[] => [...this.mappings.values()];

  public flush = (changes: PendingChanges): Promise<void> => {
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
  destination: HalfFailingDestination,
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

describe("a mid-run failure never orphans earlier events", () => {
  it("keeps a mapping row for every event the failed run already created", async () => {
    const destination = new HalfFailingDestination();
    const mappingStore = new MappingStore();
    const localEvents = buildLocalEvents(EVENT_COUNT);

    await expect(reconcile(destination, mappingStore, localEvents)).rejects.toThrow(
      "destination refused the write",
    );

    expect(destination.storedUids()).toHaveLength(FIRST_CHUNK_SIZE);
    expect(mappingStore.read()).toHaveLength(FIRST_CHUNK_SIZE);
    expect([...mappingStore.read()].map((mapping) => mapping.destinationEventUid).toSorted())
      .toEqual([...destination.storedUids()].toSorted());
  });

  it("lets the next healthy reconcile finish the run without deleting anything", async () => {
    const destination = new HalfFailingDestination();
    const mappingStore = new MappingStore();
    const localEvents = buildLocalEvents(EVENT_COUNT);

    await expect(reconcile(destination, mappingStore, localEvents)).rejects.toThrow(
      "destination refused the write",
    );

    destination.failingPushCall = null;
    const healthy = await reconcile(destination, mappingStore, localEvents);

    expect(healthy.added).toBe(EVENT_COUNT - FIRST_CHUNK_SIZE);
    expect(healthy.removed).toBe(0);
    expect(destination.deletedIds).toEqual([]);
    expect(mappingStore.flushedDeletes).toEqual([]);
    expect(mappingStore.read()).toHaveLength(EVENT_COUNT);
    expect(destination.storedUids()).toHaveLength(EVENT_COUNT);
  });
});
