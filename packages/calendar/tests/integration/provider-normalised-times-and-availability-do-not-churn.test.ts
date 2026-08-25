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
  EventAvailability,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../../src/core/types";

const SOURCE_CALENDAR_ID = "source-calendar";
const DESTINATION_CALENDAR_ID = "destination-calendar";
const RECONCILE_PASSES = 4;

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

/* Seconds on the wire are what a destination that keeps whole minutes has to round away. */
const localEventWithAvailability = (
  availability: EventAvailability,
): MaterializedSyncableEvent => ({
  availability,
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source calendar",
  calendarUrl: null,
  description: "Agenda",
  endTime: new Date("2026-05-14T10:00:30.000Z"),
  id: "sync-event-1",
  location: "Meeting room",
  sourceEventUid: "source-uid-1",
  startTime: new Date("2026-05-14T09:00:30.000Z"),
  summary: "Weekly planning",
});

interface StoredDestinationEvent {
  availability: EventAvailability;
  description: string;
  endTime: Date;
  location: string;
  startTime: Date;
  summary: string;
  uid: string;
}

interface DestinationBehaviour {
  /* The static list the provider advertises, as all three destination providers hardcode one. */
  readonly supportedAvailabilities: EventAvailability[];
  readonly storeAvailability: (requested: EventAvailability) => EventAvailability;
  readonly storeInstant: (instant: Date) => Date;
}

const keepInstant = (instant: Date): Date => instant;

const floorInstantToMinute = (instant: Date): Date => {
  const floored = new Date(instant);
  floored.setUTCSeconds(0, 0);
  return floored;
};

const keepAvailability = (requested: EventAvailability): EventAvailability => requested;

const coerceAvailabilityToBusy = (): EventAvailability => "busy";

/*
 * Stands in for a destination that stores a normalised version of the times or the availability
 * it was sent, the way a server that keeps whole minutes or rewrites TRANSP does.
 */
class NormalisingDestination {
  private nextRemoteId = 1;
  private readonly stored = new Map<string, StoredDestinationEvent>();
  public readonly pushedEventIds: string[] = [];
  public readonly deletedIds: string[] = [];

  private readonly behaviour: DestinationBehaviour;

  public constructor(behaviour: DestinationBehaviour) {
    this.behaviour = behaviour;
  }

  public pushEvents = (events: MaterializedSyncableEvent[]): Promise<PushResult[]> =>
    Promise.resolve(events.map((event): PushResult => {
      this.pushedEventIds.push(event.id);
      const uid = `remote-uid-${this.nextRemoteId}`;
      this.nextRemoteId += 1;
      this.stored.set(uid, {
        availability: this.behaviour.storeAvailability(event.availability ?? "busy"),
        description: event.description ?? "",
        endTime: this.behaviour.storeInstant(event.endTime),
        location: event.location ?? "",
        startTime: this.behaviour.storeInstant(event.startTime),
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

  public snapshot = (): RemoteEvent[] =>
    [...this.stored.values()].map((stored): RemoteEvent => {
      const content = createEditableEventContentSnapshot({
        description: stored.description,
        location: stored.location,
        summary: stored.summary,
      });

      return {
        deleteId: stored.uid,
        editableAvailability: stored.availability,
        editableContent: content,
        editableContentHash: hashEditableEventContentSnapshot(content),
        endTime: stored.endTime,
        isKeeperEvent: true,
        startTime: stored.startTime,
        supportedAvailabilities: this.behaviour.supportedAvailabilities,
        uid: stored.uid,
      };
    });
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
  destination: NormalisingDestination,
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

const reconcileRepeatedly = async (
  behaviour: DestinationBehaviour,
  localEvent: MaterializedSyncableEvent,
): Promise<NormalisingDestination> => {
  const destination = new NormalisingDestination(behaviour);
  const mappingStore = new MappingStore();

  for (let pass = 0; pass < RECONCILE_PASSES; pass += 1) {
    await reconcile(destination, mappingStore, localEvent);
  }

  return destination;
};

interface ChurnCase {
  readonly availability: EventAvailability;
  readonly behaviour: DestinationBehaviour;
  readonly name: string;
}

const TIME_FLOORING_CASES: ChurnCase[] = [
  {
    availability: "busy",
    behaviour: {
      storeAvailability: keepAvailability,
      storeInstant: floorInstantToMinute,
      supportedAvailabilities: ["busy", "free"],
    },
    name: "a Google-shaped destination that floors stored times to the whole minute",
  },
  {
    availability: "busy",
    behaviour: {
      storeAvailability: keepAvailability,
      storeInstant: floorInstantToMinute,
      supportedAvailabilities: ["busy", "free", "oof", "workingElsewhere"],
    },
    name: "an Outlook-shaped destination that floors stored times to the whole minute",
  },
  {
    availability: "busy",
    behaviour: {
      storeAvailability: keepAvailability,
      storeInstant: floorInstantToMinute,
      supportedAvailabilities: ["busy", "free"],
    },
    name: "a CalDAV-shaped destination that floors stored times to the whole minute",
  },
];

const AVAILABILITY_COERCING_CASES: ChurnCase[] = [
  {
    availability: "free",
    behaviour: {
      storeAvailability: coerceAvailabilityToBusy,
      storeInstant: keepInstant,
      supportedAvailabilities: ["busy", "free"],
    },
    name: "a Google-shaped destination that stores every event as busy",
  },
  {
    availability: "oof",
    behaviour: {
      storeAvailability: coerceAvailabilityToBusy,
      storeInstant: keepInstant,
      supportedAvailabilities: ["busy", "free", "oof", "workingElsewhere"],
    },
    name: "an Outlook-shaped destination that stores every event as busy",
  },
  {
    availability: "free",
    behaviour: {
      storeAvailability: coerceAvailabilityToBusy,
      storeInstant: keepInstant,
      supportedAvailabilities: ["busy", "free"],
    },
    name: "a CalDAV-shaped destination that rewrites TRANSP to opaque",
  },
];

describe("a provider that normalises the times it stored does not look changed", () => {
  for (const churnCase of TIME_FLOORING_CASES) {
    it(`converges against ${churnCase.name}`, async () => {
      const destination = await reconcileRepeatedly(
        churnCase.behaviour,
        localEventWithAvailability(churnCase.availability),
      );

      expect(destination.deletedIds).toEqual([]);
      expect(destination.pushedEventIds).toEqual(["sync-event-1"]);
    });
  }
});

describe("a provider that normalises the availability it stored does not look changed", () => {
  for (const churnCase of AVAILABILITY_COERCING_CASES) {
    it(`converges against ${churnCase.name}`, async () => {
      const destination = await reconcileRepeatedly(
        churnCase.behaviour,
        localEventWithAvailability(churnCase.availability),
      );

      expect(destination.deletedIds).toEqual([]);
      expect(destination.pushedEventIds).toEqual(["sync-event-1"]);
    });
  }
});
