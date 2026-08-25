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

const LOCAL_EVENT: MaterializedSyncableEvent = {
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source calendar",
  calendarUrl: null,
  description: "Agenda",
  endTime: new Date("2026-05-14T10:00:00.000Z"),
  id: "sync-event-1",
  location: "Meeting room",
  sourceEventUid: "source-uid-1",
  startTime: new Date("2026-05-14T09:00:00.000Z"),
  summary: "Weekly planning",
};

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
 * A CalDAV-shaped destination: pushEvents never throws and never reports a stored
 * hash, so the post-write lookup always fires, and that lookup can fail on its own.
 */
class FlakyLookupDestination {
  private nextRemoteId = 1;
  private readonly stored = new Map<string, StoredDestinationEvent>();
  public readonly pushedEventIds: string[] = [];
  public readonly deletedIds: string[] = [];
  public lookupFails = false;
  public lookupAttempts = 0;

  public pushEvents = (events: MaterializedSyncableEvent[]): Promise<PushResult[]> =>
    Promise.resolve(events.map((event): PushResult => {
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

const reconcile = (destination: FlakyLookupDestination, mappingStore: MappingStore) =>
  syncCalendar({
    calendarId: DESTINATION_CALENDAR_ID,
    flush: mappingStore.flush,
    isCurrent: () => Promise.resolve(true),
    provider: destination,
    readState: () => Promise.resolve({
      existingMappings: mappingStore.read(),
      localEvents: [LOCAL_EVENT],
      remoteEvents: destination.snapshot(),
    }),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });

describe("a failed hash lookup never costs the mapping", () => {
  it("still flushes the mapping for an event the provider already created", async () => {
    const destination = new FlakyLookupDestination();
    const mappingStore = new MappingStore();
    destination.lookupFails = true;

    await expect(reconcile(destination, mappingStore)).resolves.toMatchObject({
      added: 1,
      addFailed: 0,
      removed: 0,
      removeFailed: 0,
    });
    expect(destination.lookupAttempts).toBe(1);
    expect(destination.pushedEventIds).toEqual([LOCAL_EVENT.id]);

    const [remote] = destination.snapshot();
    const [mapping] = mappingStore.read();
    expect(mapping?.destinationEventUid).toBe(remote?.uid);
    expect(mapping?.remoteContentHash ?? null).toBeNull();
  });

  it("leaves the next healthy reconcile with nothing to delete and nothing to push", async () => {
    const destination = new FlakyLookupDestination();
    const mappingStore = new MappingStore();
    destination.lookupFails = true;

    await reconcile(destination, mappingStore);

    destination.lookupFails = false;
    destination.resetCalls();

    await expect(reconcile(destination, mappingStore)).resolves.toMatchObject({
      added: 0,
      addFailed: 0,
      removed: 0,
      removeFailed: 0,
    });
    expect(destination.deletedIds).toEqual([]);
    expect(destination.pushedEventIds).toEqual([]);
    expect(destination.snapshot()).toHaveLength(1);

    const [remote] = destination.snapshot();
    const [mapping] = mappingStore.read();
    expect(mapping?.remoteContentHash).toBe(remote?.editableContentHash);
  });
});
