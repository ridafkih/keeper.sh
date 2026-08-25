import { describe, expect, it } from "vitest";
import {
  createEditableEventContentSnapshot,
  hashEditableEventContentSnapshot,
} from "../../src/core/events/content-hash";
import type { EventMapping } from "../../src/core/events/mappings";
import type { CalendarSyncProvider, PendingChanges } from "../../src/core/sync-engine/types";
import { syncCalendar } from "../../src/core/sync-engine/index";
import type {
  DeleteResult,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../../src/core/types";

const SOURCE_CALENDAR_ID = "source-calendar";
const DESTINATION_CALENDAR_ID = "destination-calendar";
const THROTTLED_READ_MESSAGE = "429 rate limit exceeded";
const OWNER_EDITED_SUMMARY = "Renamed by the calendar owner";

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

const buildLocalEvent = (startTime: Date, endTime: Date): MaterializedSyncableEvent => ({
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source calendar",
  calendarUrl: null,
  description: "Agenda for the weekly planning",
  endTime,
  id: "sync-event-1",
  location: "Meeting room",
  sourceEventUid: "source-uid-1",
  startTime,
  summary: "Weekly planning",
});

const ORIGINAL_EVENT = buildLocalEvent(
  new Date("2026-05-14T09:00:00.000Z"),
  new Date("2026-05-14T10:00:00.000Z"),
);

/* The reschedule moves the event only: the editable form the provider stored is untouched by it. */
const RESCHEDULED_EVENT = buildLocalEvent(
  new Date("2026-05-14T11:00:00.000Z"),
  new Date("2026-05-14T12:00:00.000Z"),
);

interface StoredDestinationEvent {
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

const toRemoteEvent = (stored: StoredDestinationEvent): RemoteEvent => ({
  deleteId: stored.deleteId,
  editableAvailability: "busy",
  editableContent: storedContentSnapshot(stored),
  editableContentHash: storedFormHash(stored),
  endTime: stored.endTime,
  isKeeperEvent: true,
  startTime: stored.startTime,
  supportedAvailabilities: ["busy", "free"],
  uid: stored.uid,
});

interface DestinationShape {
  /* Google and Outlook hand the stored form back on the write; CalDAV never does. */
  echoesStoredFormOnWrite: boolean;
  name: string;
  supportsInPlaceUpdate: boolean;
  toDeleteId: (suffix: number) => string;
  toUid: (suffix: number) => string;
}

const CALDAV_SHAPE: DestinationShape = {
  echoesStoredFormOnWrite: false,
  name: "CalDAV",
  supportsInPlaceUpdate: true,
  toDeleteId: (suffix) => `/calendars/destination/remote-uid-${suffix}.ics`,
  toUid: (suffix) => `remote-uid-${suffix}@keeper.sh`,
};

const GOOGLE_SHAPE: DestinationShape = {
  echoesStoredFormOnWrite: true,
  name: "Google",
  supportsInPlaceUpdate: false,
  toDeleteId: (suffix) => `google-event-${suffix}`,
  toUid: (suffix) => `google-event-${suffix}`,
};

const OUTLOOK_SHAPE: DestinationShape = {
  echoesStoredFormOnWrite: true,
  name: "Outlook",
  supportsInPlaceUpdate: false,
  toDeleteId: (suffix) => `outlook-event-${suffix}`,
  toUid: (suffix) => `outlook-uid-${suffix}`,
};

class RecordingDestination {
  private readonly shape: DestinationShape;
  private nextRemoteId = 1;
  private readonly stored = new Map<string, StoredDestinationEvent>();
  public readonly pushedEventIds: string[] = [];
  public readonly updatedDeleteIds: string[] = [];
  public readonly deletedIds: string[] = [];
  public captureFails = false;
  public writeEchoSuppressed = false;

  public constructor(shape: DestinationShape) {
    this.shape = shape;
  }

  public pushEvents = (events: MaterializedSyncableEvent[]): Promise<PushResult[]> =>
    Promise.resolve(events.map((event): PushResult => {
      this.pushedEventIds.push(event.id);
      const suffix = this.nextRemoteId;
      this.nextRemoteId += 1;
      const stored = this.write(this.shape.toUid(suffix), this.shape.toDeleteId(suffix), event);
      return {
        deleteId: stored.deleteId,
        remoteId: stored.uid,
        success: true,
        ...(this.echoesStoredForm() && { storedContentHash: storedFormHash(stored) }),
      };
    }));

  public updateEvents = (
    updates: { deleteId: string; event: MaterializedSyncableEvent }[],
  ): Promise<PushResult[]> =>
    Promise.resolve(updates.map((update): PushResult => {
      this.updatedDeleteIds.push(update.deleteId);
      const existing = this.findByIdentity(update.deleteId);
      if (!existing) {
        return { error: "no such event", success: false };
      }
      const stored = this.write(existing.uid, existing.deleteId, update.event);
      return {
        deleteId: stored.deleteId,
        remoteId: stored.uid,
        success: true,
        ...(this.echoesStoredForm() && { storedContentHash: storedFormHash(stored) }),
      };
    }));

  public deleteEvents = (deleteIds: string[]): Promise<DeleteResult[]> =>
    Promise.resolve(deleteIds.map((deleteId): DeleteResult => {
      this.deletedIds.push(deleteId);
      const existing = this.findByIdentity(deleteId);
      if (existing) {
        this.stored.delete(existing.uid);
      }
      return { success: true };
    }));

  public listRemoteEvents = (): Promise<RemoteEvent[]> => Promise.resolve(this.snapshot());

  public getRemoteEventsByIds = (eventIds: string[]): Promise<RemoteEvent[]> => {
    if (this.captureFails) {
      return Promise.reject(new Error(THROTTLED_READ_MESSAGE));
    }

    const matched: RemoteEvent[] = [];
    for (const eventId of eventIds) {
      const existing = this.findByIdentity(eventId);
      if (existing) {
        matched.push(toRemoteEvent(existing));
      }
    }
    return Promise.resolve(matched);
  };

  public snapshot = (): RemoteEvent[] =>
    [...this.stored.values()].map((stored) => toRemoteEvent(stored));

  public observedFormHashes = (): string[] =>
    [...this.stored.values()].map((stored) => storedFormHash(stored));

  public storedSummaries = (): string[] =>
    [...this.stored.values()].map((stored) => stored.summary);

  public editStoredSummary = (summary: string): void => {
    for (const [uid, stored] of this.stored) {
      this.stored.set(uid, { ...stored, summary });
    }
  };

  public resetCalls = (): void => {
    this.pushedEventIds.length = 0;
    this.updatedDeleteIds.length = 0;
    this.deletedIds.length = 0;
  };

  private echoesStoredForm = (): boolean =>
    this.shape.echoesStoredFormOnWrite && !this.writeEchoSuppressed;

  private write = (
    uid: string,
    deleteId: string,
    event: MaterializedSyncableEvent,
  ): StoredDestinationEvent => {
    const stored: StoredDestinationEvent = {
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
  destination: RecordingDestination,
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
  provider: CalendarSyncProvider,
  destination: RecordingDestination,
  mappingStore: MappingStore,
  localEvent: MaterializedSyncableEvent,
) =>
  syncCalendar({
    calendarId: DESTINATION_CALENDAR_ID,
    flush: mappingStore.flush,
    isCurrent: () => Promise.resolve(true),
    provider,
    readState: () => Promise.resolve({
      existingMappings: mappingStore.read(),
      localEvents: [localEvent],
      remoteEvents: destination.snapshot(),
    }),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });

interface Fixture {
  destination: RecordingDestination;
  mappingStore: MappingStore;
  provider: CalendarSyncProvider;
}

const createFixture = (shape: DestinationShape): Fixture => {
  const destination = new RecordingDestination(shape);
  return { destination, mappingStore: new MappingStore(), provider: createProvider(destination, shape) };
};

const recordedHash = (mappingStore: MappingStore): string | null => {
  const [mapping] = mappingStore.read();
  return mapping?.remoteContentHash ?? null;
};

const syncWithHealthyCapture = async (fixture: Fixture): Promise<string> => {
  const { destination, mappingStore, provider } = fixture;
  await expect(reconcile(provider, destination, mappingStore, ORIGINAL_EVENT)).resolves.toMatchObject({
    added: 1,
    addFailed: 0,
    removeFailed: 0,
  });

  const baseline = recordedHash(mappingStore);
  expect(baseline).toBe(destination.observedFormHashes()[0]);
  expect(baseline).not.toBeNull();
  return String(baseline);
};

const rescheduleWithFailedCapture = async (fixture: Fixture): Promise<void> => {
  const { destination, mappingStore, provider } = fixture;
  destination.captureFails = true;
  destination.writeEchoSuppressed = true;
  destination.resetCalls();

  await expect(reconcile(provider, destination, mappingStore, RESCHEDULED_EVENT)).resolves.toMatchObject({
    addFailed: 0,
    removeFailed: 0,
  });
};

for (const shape of [CALDAV_SHAPE, GOOGLE_SHAPE, OUTLOOK_SHAPE]) {
  describe(`a failed capture read preserves an already-recorded ${shape.name} baseline`, () => {
    it("leaves the recorded form intact instead of nulling it", async () => {
      const fixture = createFixture(shape);
      const baseline = await syncWithHealthyCapture(fixture);

      await rescheduleWithFailedCapture(fixture);

      expect(fixture.destination.storedSummaries()).toEqual([ORIGINAL_EVENT.summary]);
      expect(fixture.destination.observedFormHashes()).toEqual([baseline]);
      expect(recordedHash(fixture.mappingStore)).toBe(baseline);
    });

    it("still detects and repairs an owner rename made after the failed capture", async () => {
      const fixture = createFixture(shape);
      await syncWithHealthyCapture(fixture);
      await rescheduleWithFailedCapture(fixture);

      fixture.destination.captureFails = false;
      fixture.destination.writeEchoSuppressed = false;
      fixture.destination.editStoredSummary(OWNER_EDITED_SUMMARY);
      fixture.destination.resetCalls();

      await reconcile(fixture.provider, fixture.destination, fixture.mappingStore, RESCHEDULED_EVENT);

      expect(fixture.destination.storedSummaries()).toEqual([RESCHEDULED_EVENT.summary]);
    });
  });
}
