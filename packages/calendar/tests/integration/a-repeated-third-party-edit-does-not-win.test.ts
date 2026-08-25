import { describe, expect, it } from "vitest";
import {
  createEditableEventContentSnapshot,
  createSyncEventContentHash,
  hashEditableEventContentSnapshot,
} from "../../src/core/events/content-hash";
import type { EventMapping } from "../../src/core/events/mappings";
import type { CalendarSyncProvider, PendingChanges } from "../../src/core/sync-engine/types";
import { syncCalendar } from "../../src/core/sync-engine/index";
import type {
  DeleteResult,
  EventAvailability,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../../src/core/types";

const SOURCE_CALENDAR_ID = "source-calendar";
const DESTINATION_CALENDAR_ID = "destination-calendar";
const SEEDED_MAPPING_ID = "seeded-mapping-1";
const LOCAL_SUMMARY = "Weekly planning sync";
/* The same edit twice: a third party who retypes the title they wanted after we put ours back. */
const THIRD_PARTY_SUMMARY = "Cancelled — do not attend";

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
  availability: "free",
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source calendar",
  calendarUrl: null,
  description: "Agenda and notes",
  endTime: new Date("2026-05-14T10:00:00.000Z"),
  eventStateId: "series-state-1",
  id: "sync-event-1",
  location: "Meeting room",
  sourceEventUid: "source-uid-1",
  startTime: new Date("2026-05-14T09:00:00.000Z"),
  summary: LOCAL_SUMMARY,
};

interface StoredDestinationEvent {
  availability: EventAvailability;
  deleteId: string;
  description: string;
  endTime: Date;
  location: string;
  startTime: Date;
  summary: string;
  uid: string;
}

const storedContentSnapshot = (stored: StoredDestinationEvent) =>
  createEditableEventContentSnapshot({
    description: stored.description,
    location: stored.location,
    summary: stored.summary,
  });

const storedFormHash = (stored: StoredDestinationEvent): string =>
  hashEditableEventContentSnapshot(storedContentSnapshot(stored));

interface DestinationShape {
  /* Google and Outlook hand the stored form back on the write; CalDAV never does. */
  echoesStoredFormOnWrite: boolean;
  name: string;
  supportedAvailabilities: EventAvailability[];
  supportsInPlaceUpdate: boolean;
  toDeleteId: (suffix: number) => string;
  toUid: (suffix: number) => string;
}

/* Every replacement is an in-place update, the write echoes nothing, and busy is all it keeps. */
const CALDAV_SHAPE: DestinationShape = {
  echoesStoredFormOnWrite: false,
  name: "CalDAV",
  supportedAvailabilities: ["busy"],
  supportsInPlaceUpdate: true,
  toDeleteId: (suffix) => `/calendars/destination/remote-uid-${suffix}.ics`,
  toUid: (suffix) => `remote-uid-${suffix}@keeper.test`,
};

/* No in-place update at all: the write echoes the stored form and every replacement recreates. */
const GOOGLE_SHAPE: DestinationShape = {
  echoesStoredFormOnWrite: true,
  name: "Google",
  supportedAvailabilities: ["busy", "free"],
  supportsInPlaceUpdate: false,
  toDeleteId: (suffix) => `google-event-${suffix}`,
  toUid: (suffix) => `google-event-${suffix}`,
};

const OUTLOOK_SHAPE: DestinationShape = {
  echoesStoredFormOnWrite: true,
  name: "Outlook",
  supportedAvailabilities: ["busy", "free", "oof", "workingElsewhere"],
  supportsInPlaceUpdate: false,
  toDeleteId: (suffix) => `outlook-event-${suffix}`,
  toUid: (suffix) => `outlook-uid-${suffix}`,
};

const storedAvailability = (
  shape: DestinationShape,
  availability: EventAvailability | undefined,
): EventAvailability => {
  if (availability && shape.supportedAvailabilities.includes(availability)) {
    return availability;
  }
  return "busy";
};

const toRemoteEvent = (
  stored: StoredDestinationEvent,
  shape: DestinationShape,
): RemoteEvent => ({
  deleteId: stored.deleteId,
  editableAvailability: stored.availability,
  editableContent: storedContentSnapshot(stored),
  editableContentHash: storedFormHash(stored),
  endTime: stored.endTime,
  isKeeperEvent: true,
  startTime: stored.startTime,
  supportedAvailabilities: shape.supportedAvailabilities,
  uid: stored.uid,
});

/* Keeps exactly what it is sent, so every difference in a stored form is somebody's edit. */
class FaithfulDestination {
  private readonly shape: DestinationShape;
  private nextRemoteId = 1;
  private readonly stored = new Map<string, StoredDestinationEvent>();
  public deleteCalls = 0;
  public pushCalls = 0;
  public updateCalls = 0;

  public constructor(shape: DestinationShape) {
    this.shape = shape;
  }

  public seed = (event: MaterializedSyncableEvent): StoredDestinationEvent => {
    const suffix = this.nextRemoteId;
    this.nextRemoteId += 1;
    return this.write(this.shape.toUid(suffix), this.shape.toDeleteId(suffix), event);
  };

  /* A person editing the mirrored copy in their own calendar client. */
  public thirdPartyEdit = (summary: string): void => {
    const existing = this.onlyStored();
    this.stored.set(existing.uid, { ...existing, summary });
  };

  public pushEvents = (events: MaterializedSyncableEvent[]): Promise<PushResult[]> =>
    Promise.resolve(events.map((event): PushResult => {
      this.pushCalls += 1;
      const suffix = this.nextRemoteId;
      this.nextRemoteId += 1;
      const stored = this.write(this.shape.toUid(suffix), this.shape.toDeleteId(suffix), event);
      return this.toPushResult(stored);
    }));

  public updateEvents = (
    updates: { deleteId: string; event: MaterializedSyncableEvent }[],
  ): Promise<PushResult[]> =>
    Promise.resolve(updates.map((update): PushResult => {
      this.updateCalls += 1;
      const existing = this.findByIdentity(update.deleteId);
      if (!existing) {
        return { error: "no such event", success: false };
      }
      return this.toPushResult(this.write(existing.uid, existing.deleteId, update.event));
    }));

  public deleteEvents = (deleteIds: string[]): Promise<DeleteResult[]> =>
    Promise.resolve(deleteIds.map((deleteId): DeleteResult => {
      this.deleteCalls += 1;
      const existing = this.findByIdentity(deleteId);
      if (existing) {
        this.stored.delete(existing.uid);
      }
      return { success: true };
    }));

  public listRemoteEvents = (): Promise<RemoteEvent[]> => Promise.resolve(this.snapshot());

  public getRemoteEventsByIds = (eventIds: string[]): Promise<RemoteEvent[]> => {
    const matched: RemoteEvent[] = [];
    for (const eventId of eventIds) {
      const existing = this.findByIdentity(eventId);
      if (existing) {
        matched.push(toRemoteEvent(existing, this.shape));
      }
    }
    return Promise.resolve(matched);
  };

  public snapshot = (): RemoteEvent[] =>
    [...this.stored.values()].map((stored) => toRemoteEvent(stored, this.shape));

  public onlyStored = (): StoredDestinationEvent => {
    const [stored] = [...this.stored.values()];
    if (!stored) {
      throw new Error("expected exactly one stored destination event");
    }
    return stored;
  };

  public writeCalls = (): number => this.pushCalls + this.updateCalls + this.deleteCalls;

  public resetCalls = (): void => {
    this.deleteCalls = 0;
    this.pushCalls = 0;
    this.updateCalls = 0;
  };

  private toPushResult = (stored: StoredDestinationEvent): PushResult => {
    if (!this.shape.echoesStoredFormOnWrite) {
      return { deleteId: stored.deleteId, remoteId: stored.uid, success: true };
    }
    return {
      deleteId: stored.deleteId,
      remoteId: stored.uid,
      storedAvailability: stored.availability,
      storedContentHash: storedFormHash(stored),
      storedEndTime: stored.endTime,
      storedStartTime: stored.startTime,
      success: true,
    };
  };

  private write = (
    uid: string,
    deleteId: string,
    event: MaterializedSyncableEvent,
  ): StoredDestinationEvent => {
    const stored: StoredDestinationEvent = {
      availability: storedAvailability(this.shape, event.availability),
      deleteId,
      description: event.description ?? "",
      endTime: event.endTime,
      location: event.location ?? "",
      startTime: event.startTime,
      summary: event.summary,
      uid,
    };
    this.stored.set(uid, stored);
    return stored;
  };

  private findByIdentity = (identity: string): StoredDestinationEvent | undefined => {
    for (const stored of this.stored.values()) {
      if (stored.uid === identity || stored.deleteId === identity) {
        return stored;
      }
    }
    return globalThis.undefined;
  };
}

const createProvider = (
  destination: FaithfulDestination,
  shape: DestinationShape,
): CalendarSyncProvider => ({
  deleteEvents: destination.deleteEvents,
  getRemoteEventsByIds: destination.getRemoteEventsByIds,
  listRemoteEvents: destination.listRemoteEvents,
  pushEvents: destination.pushEvents,
  ...(shape.supportsInPlaceUpdate && { updateEvents: destination.updateEvents }),
});

class MappingStore {
  private nextMappingId = 1;
  public readonly mappings = new Map<string, EventMapping>();

  public seed = (mapping: EventMapping): void => {
    this.mappings.set(mapping.id, mapping);
  };

  public read = (): EventMapping[] => [...this.mappings.values()];

  public onlyMapping = (): EventMapping => {
    const [mapping] = this.read();
    if (!mapping) {
      throw new Error("expected exactly one mapping");
    }
    return mapping;
  };

  public flush = (changes: PendingChanges): Promise<void> => {
    for (const mappingId of changes.deletes) {
      this.mappings.delete(mappingId);
    }

    for (const insert of changes.inserts) {
      const mappingId = `mapping-${this.nextMappingId}`;
      this.nextMappingId += 1;
      this.mappings.set(mappingId, { ...insert, id: mappingId });
    }

    /* An omitted field is what the SQL coalesce keeps: spreading models exactly that. */
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
  destination: FaithfulDestination,
  shape: DestinationShape,
  mappingStore: MappingStore,
) =>
  syncCalendar({
    calendarId: DESTINATION_CALENDAR_ID,
    flush: mappingStore.flush,
    isCurrent: () => Promise.resolve(true),
    provider: createProvider(destination, shape),
    readState: () => Promise.resolve({
      existingMappings: mappingStore.read(),
      localEvents: [LOCAL_EVENT],
      remoteEvents: destination.snapshot(),
    }),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });

/* A mirrored copy the destination is holding exactly as we last wrote it, and a mapping saying so. */
const buildMirroredState = (
  shape: DestinationShape,
): { destination: FaithfulDestination; mappingStore: MappingStore } => {
  const destination = new FaithfulDestination(shape);
  const stored = destination.seed(LOCAL_EVENT);
  const mappingStore = new MappingStore();
  mappingStore.seed({
    calendarId: DESTINATION_CALENDAR_ID,
    deleteIdentifier: stored.deleteId,
    destinationEventUid: stored.uid,
    endTime: LOCAL_EVENT.endTime,
    eventStateId: LOCAL_EVENT.eventStateId ?? null,
    id: SEEDED_MAPPING_ID,
    remoteAvailability: stored.availability,
    remoteContentHash: storedFormHash(stored),
    remoteEndTime: stored.endTime,
    remoteStartTime: stored.startTime,
    sourceCalendarId: SOURCE_CALENDAR_ID,
    startTime: LOCAL_EVENT.startTime,
    syncEventHash: createSyncEventContentHash(LOCAL_EVENT),
    syncEventId: LOCAL_EVENT.id,
  });
  return { destination, mappingStore };
};

const repairedFromOf = (mapping: EventMapping): string | null =>
  mapping.remoteContentHashRepairedFrom ?? null;

const SHAPES: DestinationShape[] = [CALDAV_SHAPE, GOOGLE_SHAPE, OUTLOOK_SHAPE];

for (const shape of SHAPES) {
  describe(`a repeated third-party edit of a ${shape.name} remote`, () => {
    it("is repaired again rather than adopted as the baseline", async () => {
      const { destination, mappingStore } = buildMirroredState(shape);

      destination.thirdPartyEdit(THIRD_PARTY_SUMMARY);
      destination.resetCalls();
      await reconcile(destination, shape, mappingStore);

      expect(destination.onlyStored().summary).toBe(LOCAL_SUMMARY);
      expect(destination.writeCalls()).toBeGreaterThan(0);

      /* The identical edit again: retyping the title they wanted after we put ours back. */
      destination.thirdPartyEdit(THIRD_PARTY_SUMMARY);
      destination.resetCalls();
      await reconcile(destination, shape, mappingStore);

      expect(destination.onlyStored().summary).toBe(LOCAL_SUMMARY);
      expect(destination.writeCalls()).toBeGreaterThan(0);

      destination.resetCalls();
      await reconcile(destination, shape, mappingStore);

      expect(destination.writeCalls()).toBe(0);
      expect(destination.onlyStored().summary).toBe(LOCAL_SUMMARY);
    });

    it("leaves no proof standing once the pass that recorded it has resolved", async () => {
      const { destination, mappingStore } = buildMirroredState(shape);

      destination.thirdPartyEdit(THIRD_PARTY_SUMMARY);
      await reconcile(destination, shape, mappingStore);

      /* Their text is nothing our own text could have become here, so it proves nothing. */
      expect(repairedFromOf(mappingStore.onlyMapping())).toBeNull();

      destination.thirdPartyEdit(THIRD_PARTY_SUMMARY);
      await reconcile(destination, shape, mappingStore);

      expect(repairedFromOf(mappingStore.onlyMapping())).toBeNull();
    });
  });
}
