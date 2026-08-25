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
const LEGACY_MAPPING_ID = "legacy-mapping-1";
const SERIES_STATE_ID = "series-state-1";
const CONVERGENCE_PASSES = 4;

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

const buildLocalEvent = (
  overrides: Partial<MaterializedSyncableEvent>,
): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source calendar",
  calendarUrl: null,
  description: "Agenda and notes",
  endTime: new Date("2026-05-14T10:00:00.000Z"),
  eventStateId: SERIES_STATE_ID,
  id: "sync-event-1",
  location: "Meeting room",
  sourceEventUid: "source-uid-1",
  startTime: new Date("2026-05-14T09:00:00.000Z"),
  summary: "Weekly planning sync",
  ...overrides,
});

/* A meeting the customer is in: blocked locally, and mirrored so others see them blocked. */
const BLOCKED_LOCAL_EVENT = buildLocalEvent({ availability: "busy" });
/* The other direction, for the destination that rewrites whatever TRANSP it is sent. */
const UNBLOCKED_LOCAL_EVENT = buildLocalEvent({ availability: "free" });

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
  /* A hardcoded static literal in all three providers, never derived from server behaviour. */
  supportedAvailabilities: EventAvailability[];
  supportsInPlaceUpdate: boolean;
  toDeleteId: (suffix: number) => string;
  toUid: (suffix: number) => string;
}

/* Every replacement is an in-place update and the write echoes nothing back. */
const CALDAV_SHAPE: DestinationShape = {
  echoesStoredFormOnWrite: false,
  name: "CalDAV",
  supportedAvailabilities: ["busy", "free"],
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

/*
 * A coercing server rewrites TRANSP on the way in and reports the rewritten value on every read.
 * A server that coerces nothing keeps exactly what it was handed, so a value it reports that we
 * never wrote came from somebody else.
 */
const applyServerCoercion = (
  availability: EventAvailability | undefined,
  coercesTo: EventAvailability | null,
): EventAvailability => {
  if (coercesTo !== null) {
    return coercesTo;
  }
  return availability ?? "busy";
};

class AvailabilityDestination {
  private readonly coercesTo: EventAvailability | null;
  private readonly shape: DestinationShape;
  private nextRemoteId = 1;
  private readonly stored = new Map<string, StoredDestinationEvent>();
  public deleteCalls = 0;
  public pushCalls = 0;
  public updateCalls = 0;

  public constructor(shape: DestinationShape, coercesTo: EventAvailability | null) {
    this.coercesTo = coercesTo;
    this.shape = shape;
  }

  public seed = (
    event: MaterializedSyncableEvent,
    availability: EventAvailability,
  ): StoredDestinationEvent => {
    const suffix = this.nextRemoteId;
    this.nextRemoteId += 1;
    return this.write(this.shape.toUid(suffix), this.shape.toDeleteId(suffix), {
      ...event,
      availability,
    });
  };

  /* A third party edits the destination copy directly; nothing about the mapping changes. */
  public flipStoredAvailability = (availability: EventAvailability): void => {
    const stored = this.onlyStored();
    this.stored.set(stored.uid, { ...stored, availability });
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

  public storedAvailability = (): EventAvailability => this.onlyStored().availability;

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
      availability: applyServerCoercion(event.availability, this.coercesTo),
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
  destination: AvailabilityDestination,
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
  destination: AvailabilityDestination,
  shape: DestinationShape,
  mappingStore: MappingStore,
  localEvents: MaterializedSyncableEvent[],
) =>
  syncCalendar({
    calendarId: DESTINATION_CALENDAR_ID,
    flush: mappingStore.flush,
    isCurrent: () => Promise.resolve(true),
    provider: createProvider(destination, shape),
    readState: () => Promise.resolve({
      existingMappings: mappingStore.read(),
      localEvents,
      remoteEvents: destination.snapshot(),
    }),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });

/*
 * Migration 0094 ships remoteAvailability empty with no backfill, so this is the state of every
 * mapping in the fleet on the deploy that first reads it.
 */
const buildBaselinelessMapping = (
  localEvent: MaterializedSyncableEvent,
  stored: StoredDestinationEvent,
): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: stored.deleteId,
  destinationEventUid: stored.uid,
  endTime: localEvent.endTime,
  eventStateId: localEvent.eventStateId ?? null,
  id: LEGACY_MAPPING_ID,
  remoteAvailability: null,
  remoteContentHash: null,
  remoteEndTime: null,
  remoteStartTime: null,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: localEvent.startTime,
  syncEventHash: createSyncEventContentHash(localEvent),
  syncEventId: localEvent.id,
});

/* A faithful mirror of the blocked meeting, then somebody flips it to free on the destination. */
const buildFlippedState = (
  shape: DestinationShape,
): { destination: AvailabilityDestination; mappingStore: MappingStore } => {
  const destination = new AvailabilityDestination(shape, null);
  const stored = destination.seed(BLOCKED_LOCAL_EVENT, "busy");
  const mappingStore = new MappingStore();
  mappingStore.seed(buildBaselinelessMapping(BLOCKED_LOCAL_EVENT, stored));
  destination.flipStoredAvailability("free");
  return { destination, mappingStore };
};

const SHAPES: DestinationShape[] = [CALDAV_SHAPE, GOOGLE_SHAPE, OUTLOOK_SHAPE];

for (const shape of SHAPES) {
  describe(`an availability flip on a baseline-less ${shape.name} mapping`, () => {
    it("repairs a third-party free flip on the first pass that sees it", async () => {
      const { destination, mappingStore } = buildFlippedState(shape);

      await reconcile(destination, shape, mappingStore, [BLOCKED_LOCAL_EVENT]);

      expect(destination.storedAvailability()).toBe("busy");
    });

    it("keeps the repaired availability without rewriting it again", async () => {
      const { destination, mappingStore } = buildFlippedState(shape);

      await reconcile(destination, shape, mappingStore, [BLOCKED_LOCAL_EVENT]);
      destination.resetCalls();
      await reconcile(destination, shape, mappingStore, [BLOCKED_LOCAL_EVENT]);

      expect(destination.storedAvailability()).toBe("busy");
      expect(destination.writeCalls()).toBe(0);
    });

    it("converges without churn against a destination that coerces what it is sent", async () => {
      const destination = new AvailabilityDestination(shape, "busy");
      const mappingStore = new MappingStore();

      for (let pass = 0; pass < CONVERGENCE_PASSES; pass += 1) {
        await reconcile(destination, shape, mappingStore, [UNBLOCKED_LOCAL_EVENT]);
      }

      expect(destination.deleteCalls).toBe(0);
      expect(destination.pushCalls).toBe(1);
      expect(destination.storedAvailability()).toBe("busy");
    });
  });
}
