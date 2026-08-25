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
const SERIES_OCCURRENCE_COUNT = 6;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SERIES_TITLE = "Team sync";
const RENAMED_SERIES_TITLE = "Team sync — Q2 planning";
const LOCAL_SUMMARY = "Weekly planning sync";
/* A destination that really does cut the field it stores, at a length it always cuts at. */
const DESTINATION_SUMMARY_LIMIT = 12;
const ARBITRARY_TRUNCATION_LENGTH = 6;

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
  availability: "free",
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
  summary: LOCAL_SUMMARY,
  ...overrides,
});

const SINGLE_LOCAL_EVENT = buildLocalEvent({});

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

/* Only the destinations that really cut a field cut one; the rest keep exactly what they were sent. */
const applySummaryLimit = (summary: string, limit: number | null): string => {
  if (limit === null) {
    return summary;
  }
  return summary.slice(0, limit);
};

class LengthLimitedDestination {
  private readonly shape: DestinationShape;
  private readonly summaryLimit: number | null;
  private nextRemoteId = 1;
  private readonly stored = new Map<string, StoredDestinationEvent>();
  public deleteCalls = 0;
  public pushCalls = 0;
  public updateCalls = 0;

  public constructor(shape: DestinationShape, summaryLimit: number | null) {
    this.shape = shape;
    this.summaryLimit = summaryLimit;
  }

  public seed = (event: MaterializedSyncableEvent, summary: string): StoredDestinationEvent => {
    const suffix = this.nextRemoteId;
    this.nextRemoteId += 1;
    const stored = this.write(
      this.shape.toUid(suffix),
      this.shape.toDeleteId(suffix),
      { ...event, summary },
    );
    return stored;
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

  public storedSummaries = (): string[] =>
    [...this.stored.values()].map((stored) => stored.summary).toSorted();

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
      summary: applySummaryLimit(event.summary, this.summaryLimit),
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
  destination: LengthLimitedDestination,
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
  destination: LengthLimitedDestination,
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
 * Migrations 0094 and 0095 ship the baseline columns empty with no backfill, so this is the
 * state of every mapping in the fleet on the deploy that first reads them.
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

const buildEditedState = (
  shape: DestinationShape,
  remoteSummary: string,
): { destination: LengthLimitedDestination; mappingStore: MappingStore } => {
  const destination = new LengthLimitedDestination(shape, null);
  const stored = destination.seed(SINGLE_LOCAL_EVENT, remoteSummary);
  const mappingStore = new MappingStore();
  mappingStore.seed(buildBaselinelessMapping(SINGLE_LOCAL_EVENT, stored));
  return { destination, mappingStore };
};

const buildSeriesOccurrence = (
  index: number,
  summary: string,
  idPrefix: string,
): MaterializedSyncableEvent => {
  const startTime = new Date(Date.UTC(2026, 4, 4, 9) + index * WEEK_MS);
  return buildLocalEvent({
    endTime: new Date(startTime.getTime() + 60 * 60 * 1000),
    id: `${idPrefix}-${index}`,
    sourceEventUid: `${idPrefix}-uid-${index}`,
    startTime,
    summary,
  });
};

/* The occurrence ids are reseeded by the re-anchor, so the pairing is all that carries the rename. */
const buildReanchoredSeriesState = (
  shape: DestinationShape,
): {
  destination: LengthLimitedDestination;
  mappingStore: MappingStore;
  renamedOccurrences: MaterializedSyncableEvent[];
} => {
  const destination = new LengthLimitedDestination(shape, null);
  const mappingStore = new MappingStore();

  for (let index = 0; index < SERIES_OCCURRENCE_COUNT; index += 1) {
    const previousOccurrence = buildSeriesOccurrence(index, SERIES_TITLE, "old-occurrence");
    const stored = destination.seed(previousOccurrence, SERIES_TITLE);
    mappingStore.seed({
      ...buildBaselinelessMapping(previousOccurrence, stored),
      id: `legacy-mapping-${index}`,
      remoteAvailability: stored.availability,
      remoteContentHash: storedFormHash(stored),
      remoteEndTime: stored.endTime,
      remoteStartTime: stored.startTime,
    });
  }

  const renamedOccurrences: MaterializedSyncableEvent[] = [];
  for (let index = 1; index <= SERIES_OCCURRENCE_COUNT; index += 1) {
    renamedOccurrences.push(buildSeriesOccurrence(index, RENAMED_SERIES_TITLE, "new-occurrence"));
  }

  return { destination, mappingStore, renamedOccurrences };
};

const SHAPES: DestinationShape[] = [CALDAV_SHAPE, GOOGLE_SHAPE, OUTLOOK_SHAPE];

for (const shape of SHAPES) {
  describe(`a shortened or cleared ${shape.name} remote`, () => {
    it("repairs a summary a third party cleared to empty", async () => {
      const { destination, mappingStore } = buildEditedState(shape, "");

      await reconcile(destination, shape, mappingStore, [SINGLE_LOCAL_EVENT]);

      expect(destination.onlyStored().summary).toBe(LOCAL_SUMMARY);
      expect(destination.writeCalls()).toBeGreaterThan(0);
    });

    it("repairs a summary truncated to an arbitrary length", async () => {
      const { destination, mappingStore } = buildEditedState(
        shape,
        LOCAL_SUMMARY.slice(0, ARBITRARY_TRUNCATION_LENGTH),
      );

      await reconcile(destination, shape, mappingStore, [SINGLE_LOCAL_EVENT]);

      expect(destination.onlyStored().summary).toBe(LOCAL_SUMMARY);
      expect(destination.writeCalls()).toBeGreaterThan(0);
    });

    it("still converges without churn against a destination that enforces its own limit", async () => {
      const destination = new LengthLimitedDestination(shape, DESTINATION_SUMMARY_LIMIT);
      const mappingStore = new MappingStore();

      for (let pass = 0; pass < 4; pass += 1) {
        await reconcile(destination, shape, mappingStore, [SINGLE_LOCAL_EVENT]);
      }
      destination.resetCalls();
      await reconcile(destination, shape, mappingStore, [SINGLE_LOCAL_EVENT]);

      expect(destination.writeCalls()).toBe(0);
      expect(destination.onlyStored().summary)
        .toBe(LOCAL_SUMMARY.slice(0, DESTINATION_SUMMARY_LIMIT));
    });

    it("rewrites every surviving occurrence of a re-anchored series whose title gained a suffix", async () => {
      const { destination, mappingStore, renamedOccurrences } = buildReanchoredSeriesState(shape);

      await reconcile(destination, shape, mappingStore, renamedOccurrences);

      expect(destination.storedSummaries())
        .toEqual(Array.from({ length: SERIES_OCCURRENCE_COUNT }, () => RENAMED_SERIES_TITLE));
    });
  });
}
