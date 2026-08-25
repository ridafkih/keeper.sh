import { describe, expect, it } from "vitest";
import {
  createEditableEventContentSnapshot,
  createSyncEventContentHash,
  hashEditableEventContentSnapshot,
} from "../../src/core/events/content-hash";
import type {
  DeleteResult,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../../src/core/types";
import type { EventMapping } from "../../src/core/events/mappings";
import { normalizeCalDAVEvent } from "../../src/providers/caldav/destination/normalize-event";
import { normalizeGoogleEvent } from "../../src/providers/google/destination/normalize-event";
import { normalizeOutlookEvent } from "../../src/providers/outlook/destination/normalize-event";
import type { PendingChanges } from "../../src/core/sync-engine/types";
import { syncCalendar } from "../../src/core/sync-engine/index";

const SOURCE_CALENDAR_ID = "source-calendar";
const DESTINATION_CALENDAR_ID = "destination-calendar";
const LEGACY_MAPPING_ID = "legacy-mapping-1";
const LEGACY_REMOTE_UID = "legacy-remote-uid-1";
const OWNER_EDITED_SUMMARY = "Renamed by the calendar owner";
const CONFERENCE_DELIMITER = `-::~:~::${"-".repeat(44)}::~:~::-`;

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

const BASE_LOCAL_EVENT: MaterializedSyncableEvent = {
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source calendar",
  calendarUrl: null,
  description: "Agenda and notes",
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
  isAllDay: boolean;
  location: string;
  startTime: Date;
  summary: string;
  uid: string;
}

const toStoredEvent = (
  event: MaterializedSyncableEvent,
  uid: string,
): StoredDestinationEvent => ({
  description: event.description ?? "",
  endTime: event.endTime,
  isAllDay: event.isAllDay ?? false,
  location: event.location ?? "",
  startTime: event.startTime,
  summary: event.summary,
  uid,
});

const toRemoteEvent = (stored: StoredDestinationEvent): RemoteEvent => {
  const content = createEditableEventContentSnapshot({
    description: stored.description,
    endTime: stored.endTime,
    isAllDay: stored.isAllDay,
    location: stored.location,
    startTime: stored.startTime,
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

/* Stores exactly what reconciliation handed it, so a seeded row is the only source of divergence. */
class MirroringDestination {
  private nextRemoteId = 1;
  private readonly stored = new Map<string, StoredDestinationEvent>();
  public readonly pushedEventIds: string[] = [];
  public readonly deletedIds: string[] = [];

  public readonly normalizeEvent: (event: MaterializedSyncableEvent) => MaterializedSyncableEvent;

  public constructor(
    normalizeEvent: (event: MaterializedSyncableEvent) => MaterializedSyncableEvent,
  ) {
    this.normalizeEvent = normalizeEvent;
  }

  public seed = (stored: StoredDestinationEvent): void => {
    this.stored.set(stored.uid, stored);
  };

  public pushEvents = (events: MaterializedSyncableEvent[]): Promise<PushResult[]> =>
    Promise.resolve(events.map((event): PushResult => {
      this.pushedEventIds.push(event.id);
      const uid = `remote-uid-${this.nextRemoteId}`;
      this.nextRemoteId += 1;
      this.stored.set(uid, toStoredEvent(event, uid));
      return { deleteId: uid, remoteId: uid, success: true };
    }));

  public deleteEvents = (deleteIds: string[]): Promise<DeleteResult[]> =>
    Promise.resolve(deleteIds.map((deleteId): DeleteResult => {
      this.deletedIds.push(deleteId);
      this.stored.delete(deleteId);
      return { success: true };
    }));

  public listRemoteEvents = (): Promise<RemoteEvent[]> => Promise.resolve(this.snapshot());

  public getRemoteEventsByIds = (eventIds: string[]): Promise<RemoteEvent[]> =>
    Promise.resolve(this.snapshot().filter((remoteEvent) => eventIds.includes(remoteEvent.uid)
      || eventIds.includes(remoteEvent.deleteId)));

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

interface ProviderShape {
  localEvent: MaterializedSyncableEvent;
  name: string;
  normalizeEvent: (event: MaterializedSyncableEvent) => MaterializedSyncableEvent;
}

/*
 * Each shape mirrors a real destination's own normalisation, so a faithful mirror is not
 * byte-identical to the local event: a comparison made against unnormalised intent would
 * destroy and recreate every Google or CalDAV mirror on the pass that first records a baseline.
 */
const PROVIDER_SHAPES: ProviderShape[] = [
  {
    localEvent: { ...BASE_LOCAL_EVENT, description: "<p>Agenda</p><p>Notes</p>" },
    name: "CalDAV",
    normalizeEvent: normalizeCalDAVEvent,
  },
  {
    localEvent: {
      ...BASE_LOCAL_EVENT,
      description: `Agenda\n${CONFERENCE_DELIMITER}\nJoin the call\n${CONFERENCE_DELIMITER}`,
    },
    name: "Google",
    normalizeEvent: normalizeGoogleEvent,
  },
  {
    localEvent: { ...BASE_LOCAL_EVENT, isAllDay: true },
    name: "Outlook",
    normalizeEvent: normalizeOutlookEvent,
  },
];

const buildMirroredRow = (shape: ProviderShape): StoredDestinationEvent =>
  toStoredEvent(shape.normalizeEvent(shape.localEvent), LEGACY_REMOTE_UID);

const buildLegacyMapping = (shape: ProviderShape): EventMapping => {
  const normalized = shape.normalizeEvent(shape.localEvent);

  return {
    calendarId: DESTINATION_CALENDAR_ID,
    deleteIdentifier: LEGACY_REMOTE_UID,
    destinationEventUid: LEGACY_REMOTE_UID,
    endTime: normalized.endTime,
    eventStateId: normalized.id,
    id: LEGACY_MAPPING_ID,
    remoteAvailability: null,
    remoteContentHash: null,
    remoteEndTime: null,
    remoteStartTime: null,
    sourceCalendarId: SOURCE_CALENDAR_ID,
    startTime: normalized.startTime,
    syncEventHash: createSyncEventContentHash(normalized),
    syncEventId: normalized.id,
  };
};

const buildState = (
  shape: ProviderShape,
  stored: StoredDestinationEvent,
): { destination: MirroringDestination; mappingStore: MappingStore } => {
  const destination = new MirroringDestination(shape.normalizeEvent);
  destination.seed(stored);

  const mappingStore = new MappingStore();
  mappingStore.seed(buildLegacyMapping(shape));

  return { destination, mappingStore };
};

const reconcile = (
  shape: ProviderShape,
  destination: MirroringDestination,
  mappingStore: MappingStore,
) =>
  syncCalendar({
    calendarId: DESTINATION_CALENDAR_ID,
    flush: mappingStore.flush,
    isCurrent: () => Promise.resolve(true),
    provider: destination,
    readState: () => Promise.resolve({
      existingMappings: mappingStore.read(),
      localEvents: [shape.localEvent],
      remoteEvents: destination.snapshot(),
    }),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });

for (const shape of PROVIDER_SHAPES) {
  describe(`first sight of a ${shape.name} mapping with no recorded baseline`, () => {
    it("repairs a remote a third party edited before any baseline was recorded", async () => {
      const { destination, mappingStore } = buildState(shape, {
        ...buildMirroredRow(shape),
        summary: OWNER_EDITED_SUMMARY,
      });

      await expect(reconcile(shape, destination, mappingStore)).resolves.toMatchObject({
        added: 1,
        addFailed: 0,
        removed: 1,
        removeFailed: 0,
      });
      expect(destination.pushedEventIds).toEqual([shape.localEvent.id]);
      expect(destination.deletedIds).toEqual([LEGACY_REMOTE_UID]);

      const [restored] = destination.snapshot();
      expect(restored?.editableContent?.summary).toBe(shape.localEvent.summary);

      destination.resetCalls();
      await expect(reconcile(shape, destination, mappingStore)).resolves.toMatchObject({
        added: 0,
        removed: 0,
      });
      expect(destination.pushedEventIds).toEqual([]);
      expect(destination.deletedIds).toEqual([]);
    });

    it("adopts a remote that matches what we intend without writing", async () => {
      const { destination, mappingStore } = buildState(shape, buildMirroredRow(shape));
      const [remoteBefore] = destination.snapshot();

      await expect(reconcile(shape, destination, mappingStore)).resolves.toMatchObject({
        added: 0,
        addFailed: 0,
        removed: 0,
        removeFailed: 0,
      });
      expect(destination.pushedEventIds).toEqual([]);
      expect(destination.deletedIds).toEqual([]);

      expect(mappingStore.mappings.get(LEGACY_MAPPING_ID)?.remoteContentHash)
        .toBe(remoteBefore?.editableContentHash);
    });
  });
}
