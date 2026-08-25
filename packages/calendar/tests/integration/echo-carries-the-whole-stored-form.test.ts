import { describe, expect, it } from "vitest";
import {
  createEditableEventContentSnapshot,
  hashEditableEventContentSnapshot,
} from "../../src/core/events/content-hash";
import type { EventMapping } from "../../src/core/events/mappings";
import type { PendingChanges } from "../../src/core/sync-engine/types";
import { syncCalendar } from "../../src/core/sync-engine/index";
import { normalizeGoogleEvent } from "../../src/providers/google/destination/normalize-event";
import { normalizeOutlookEvent } from "../../src/providers/outlook/destination/normalize-event";
import type {
  DeleteResult,
  EventAvailability,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../../src/core/types";

const SOURCE_CALENDAR_ID = "source-calendar";
const DESTINATION_CALENDAR_ID = "destination-calendar";

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
  availability: "oof",
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source calendar",
  calendarUrl: null,
  description: "Agenda",
  endTime: new Date("2027-03-08T16:00:00.000Z"),
  eventStateId: "event-state-1",
  id: "sync-event-1",
  location: "Meeting room",
  sourceEventUid: "source-uid-1",
  startTime: new Date("2027-03-08T16:00:00.000Z"),
  summary: "Weekly planning",
  ...overrides,
} as MaterializedSyncableEvent);

interface StoredDestinationEvent {
  availability: EventAvailability;
  description: string;
  endTime: Date;
  eventId: string;
  isAllDay: boolean;
  location: string;
  startTime: Date;
  summary: string;
  uid: string;
}

const toContentSnapshot = (stored: StoredDestinationEvent) =>
  createEditableEventContentSnapshot({
    description: stored.description,
    endTime: stored.endTime,
    isAllDay: stored.isAllDay,
    location: stored.location,
    startTime: stored.startTime,
    summary: stored.summary,
  });

const contentHashFor = (stored: StoredDestinationEvent): string =>
  hashEditableEventContentSnapshot(toContentSnapshot(stored));

const toRemoteEvent = (stored: StoredDestinationEvent, shape: DestinationShape): RemoteEvent => ({
  deleteId: stored.eventId,
  editableAvailability: stored.availability,
  editableContent: toContentSnapshot(stored),
  editableContentHash: contentHashFor(stored),
  endTime: stored.endTime,
  isKeeperEvent: true,
  startTime: stored.startTime,
  supportedAvailabilities: shape.supportedAvailabilities,
  uid: stored.uid,
});

/*
 * What a Google or Outlook write hands back: the whole form the destination stored, which is the
 * read-back the engine then owes no one. Only the hash of it has a home on PushResult today.
 */
interface EchoedStoredForm {
  storedAvailability: EventAvailability;
  storedContentHash: string;
  storedEndTime: Date;
  storedStartTime: Date;
}

interface DestinationIdentity {
  eventId: string;
  uid: string;
}

interface DestinationShape {
  identityFor: (suffix: number) => DestinationIdentity;
  normalize: (event: MaterializedSyncableEvent) => MaterializedSyncableEvent;
  supportedAvailabilities: EventAvailability[];
}

/* Neither destination stores an availability it cannot represent: it stores its own and reports that. */
const storedAvailability = (
  shape: DestinationShape,
  availability: EventAvailability | undefined,
): EventAvailability => {
  if (availability && shape.supportedAvailabilities.includes(availability)) {
    return availability;
  }
  return "busy";
};

/*
 * Google reshapes every non-positive span before it stores one, and 400s the ones it will not.
 * The mirror is addressed by the event id and identified by the iCalUID.
 */
const GOOGLE_SHAPE: DestinationShape = {
  identityFor: (suffix) => ({ eventId: `google-event-${suffix}`, uid: `keeper-uid-${suffix}` }),
  normalize: normalizeGoogleEvent,
  supportedAvailabilities: ["busy", "free"],
};

/* Graph puts all-day events on whole days and refuses an inverted span; id and iCalUId differ. */
const OUTLOOK_SHAPE: DestinationShape = {
  identityFor: (suffix) => ({ eventId: `outlook-event-${suffix}`, uid: `outlook-uid-${suffix}` }),
  normalize: normalizeOutlookEvent,
  supportedAvailabilities: ["busy", "free", "oof", "workingElsewhere"],
};

/*
 * Google- and Outlook-shaped: the write echoes the form the destination actually stored, so the
 * engine owes no read-back, and there is no in-place update — every replacement is a delete and
 * a re-add. The destination reshapes the span it is handed into one it can represent, and stores
 * and reports its own availability, so the stored form is never the form that was sent.
 */
class EchoingReshapingDestination {
  private readonly shape: DestinationShape;
  private readonly stored = new Map<string, StoredDestinationEvent>();
  private nextId = 1;
  public deleteCalls = 0;
  public lookupCalls = 0;
  public pushCalls = 0;

  public constructor(shape: DestinationShape) {
    this.shape = shape;
  }

  public pushEvents = (
    events: MaterializedSyncableEvent[],
  ): Promise<(PushResult & EchoedStoredForm)[]> =>
    Promise.resolve(events.map((event): PushResult & EchoedStoredForm => {
      this.pushCalls += 1;
      const { eventId, uid } = this.shape.identityFor(this.nextId);
      this.nextId += 1;
      const reshaped = this.shape.normalize(event);
      const stored: StoredDestinationEvent = {
        availability: storedAvailability(this.shape, reshaped.availability),
        description: reshaped.description ?? "",
        endTime: reshaped.endTime,
        eventId,
        isAllDay: Boolean(reshaped.isAllDay),
        location: reshaped.location ?? "",
        startTime: reshaped.startTime,
        summary: reshaped.summary,
        uid,
      };
      this.stored.set(eventId, stored);

      return {
        deleteId: eventId,
        remoteId: uid,
        storedAvailability: stored.availability,
        storedContentHash: contentHashFor(stored),
        storedEndTime: stored.endTime,
        storedStartTime: stored.startTime,
        success: true,
      };
    }));

  public deleteEvents = (deleteIds: string[]): Promise<DeleteResult[]> =>
    Promise.resolve(deleteIds.map((deleteId): DeleteResult => {
      this.deleteCalls += 1;
      this.stored.delete(deleteId);
      return { success: true };
    }));

  public listRemoteEvents = (): Promise<RemoteEvent[]> => Promise.resolve(this.snapshot());

  public getRemoteEventsByIds = (eventIds: string[]): Promise<RemoteEvent[]> => {
    this.lookupCalls += 1;

    const matched: RemoteEvent[] = [];
    for (const eventId of eventIds) {
      const stored = this.stored.get(eventId);
      if (stored) {
        matched.push(toRemoteEvent(stored, this.shape));
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
  destination: EchoingReshapingDestination,
  mappingStore: MappingStore,
  localEvent: MaterializedSyncableEvent,
) =>
  syncCalendar({
    calendarId: DESTINATION_CALENDAR_ID,
    flush: mappingStore.flush,
    isCurrent: () => Promise.resolve(true),
    provider: destination,
    readState: () => Promise.resolve({
      existingMappings: mappingStore.read(),
      localEvents: [localEvent],
      remoteEvents: destination.snapshot(),
    }),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });

const runFourPasses = async (
  destination: EchoingReshapingDestination,
  mappingStore: MappingStore,
  localEvent: MaterializedSyncableEvent,
): Promise<void> => {
  for (let pass = 0; pass < 4; pass += 1) {
    await reconcile(destination, mappingStore, localEvent);
  }
};

const onlyMapping = (mappingStore: MappingStore): EventMapping => {
  const [mapping] = mappingStore.read();
  if (!mapping) {
    throw new Error("expected exactly one mapping");
  }
  return mapping;
};

const EVENT_CLASSES: { event: MaterializedSyncableEvent; name: string }[] = [
  {
    event: buildLocalEvent({}),
    name: "zero-duration event",
  },
  {
    event: buildLocalEvent({
      endTime: new Date("2027-03-08T15:00:00.000Z"),
      startTime: new Date("2027-03-08T16:00:00.000Z"),
    }),
    name: "inverted span",
  },
  {
    event: buildLocalEvent({
      endTime: new Date("2027-03-09T05:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2027-03-08T05:00:00.000Z"),
    }),
    name: "all-day event off the UTC day grid",
  },
];

const SHAPES: { name: string; shape: DestinationShape }[] = [
  { name: "google-shaped", shape: GOOGLE_SHAPE },
  { name: "outlook-shaped", shape: OUTLOOK_SHAPE },
];

describe("the write echo carries the whole stored form", () => {
  for (const { name: shapeName, shape } of SHAPES) {
    for (const { event, name: eventName } of EVENT_CLASSES) {
      it(`records the ${shapeName} stored times and availability for a ${eventName}`, async () => {
        const destination = new EchoingReshapingDestination(shape);
        const mappingStore = new MappingStore();

        await reconcile(destination, mappingStore, event);

        const stored = destination.onlyStored();
        const mapping = onlyMapping(mappingStore);
        expect(mapping.remoteStartTime).toEqual(stored.startTime);
        expect(mapping.remoteEndTime).toEqual(stored.endTime);
        expect(mapping.remoteAvailability).toBe(stored.availability);
        expect(mapping.remoteContentHash).toBe(contentHashFor(stored));
        expect(destination.lookupCalls).toBe(0);
      });

      it(`converges a ${eventName} on a ${shapeName} destination without extra reads`, async () => {
        const destination = new EchoingReshapingDestination(shape);
        const mappingStore = new MappingStore();

        await runFourPasses(destination, mappingStore, event);

        expect(destination.pushCalls).toBe(1);
        expect(destination.deleteCalls).toBe(0);
        expect(destination.lookupCalls).toBe(0);
      });
    }
  }
});

/*
 * Defence in depth. Both providers echo the whole form today, but nothing in the type system
 * obliges them to, and a partial echo used to buy the skip anyway: the read that would have
 * established the times was never spent, the baseline stayed empty, and the comparison fell
 * back to local intent -- which is the churn this whole mechanism exists to stop.
 */
const echoingOnlyTheHash = (
  destination: EchoingReshapingDestination,
): EchoingReshapingDestination => ({
  ...destination,
  pushEvents: async (events: MaterializedSyncableEvent[]) => {
    const results = await destination.pushEvents(events);
    return results.map((result) => ({
      deleteId: result.deleteId,
      remoteId: result.remoteId,
      storedContentHash: result.storedContentHash,
      success: result.success,
    }));
  },
} as unknown as EchoingReshapingDestination);

describe("a partial echo still owes the read it claims to replace", () => {
  it("spends the lookup and records a whole baseline anyway", async () => {
    const destination = new EchoingReshapingDestination(GOOGLE_SHAPE);
    const mappingStore = new MappingStore();

    await reconcile(echoingOnlyTheHash(destination), mappingStore, buildLocalEvent({}));

    expect(destination.lookupCalls).toBe(1);

    const stored = destination.onlyStored();
    const mapping = onlyMapping(mappingStore);
    expect(mapping.remoteStartTime).toEqual(stored.startTime);
    expect(mapping.remoteEndTime).toEqual(stored.endTime);
    expect(mapping.remoteAvailability).toBe(stored.availability);
  });

  it("converges rather than churning on the class that used to churn", async () => {
    const destination = new EchoingReshapingDestination(GOOGLE_SHAPE);
    const mappingStore = new MappingStore();
    const partial = echoingOnlyTheHash(destination);
    const zeroDuration = buildLocalEvent({ endTime: new Date("2026-05-06T09:00:00.000Z") });

    for (let pass = 0; pass < 4; pass += 1) {
      await reconcile(partial, mappingStore, zeroDuration);
    }

    expect(destination.pushCalls).toBe(1);
    expect(destination.deleteCalls).toBe(0);
  });
});
