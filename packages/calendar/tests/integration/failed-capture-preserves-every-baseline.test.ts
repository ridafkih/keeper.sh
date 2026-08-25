import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  createEditableEventContentSnapshot,
  hashEditableEventContentSnapshot,
} from "../../src/core/events/content-hash";
import type { EventMapping } from "../../src/core/events/mappings";
import { createDatabaseFlush } from "../../src/core/sync-engine/flush";
import type { CalendarSyncProvider, PendingChanges, PendingUpdate } from "../../src/core/sync-engine/types";
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
const THROTTLED_READ_MESSAGE = "429 rate limit exceeded";

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

/* The event asks for an availability the destination is free to keep, so the recorded baseline is not a default. */
const LOCAL_AVAILABILITY: EventAvailability = "free";

const buildLocalEvent = (startTime: Date, endTime: Date): MaterializedSyncableEvent => ({
  availability: LOCAL_AVAILABILITY,
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

const toRemoteEvent = (stored: StoredDestinationEvent): RemoteEvent => ({
  deleteId: stored.deleteId,
  editableAvailability: stored.availability,
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
  public readonly deletedIds: string[] = [];
  public readonly pushedEventIds: string[] = [];
  public readonly updatedDeleteIds: string[] = [];
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
      return this.toPushResult(stored);
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
      return this.toPushResult(this.write(existing.uid, existing.deleteId, update.event));
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

  public observedForms = (): CapturedBaseline[] =>
    [...this.stored.values()].map((stored) => ({
      remoteAvailability: stored.availability,
      remoteContentHash: storedFormHash(stored),
      remoteEndTime: stored.endTime,
      remoteStartTime: stored.startTime,
    }));

  public resetCalls = (): void => {
    this.deletedIds.length = 0;
    this.pushedEventIds.length = 0;
    this.updatedDeleteIds.length = 0;
  };

  private echoesStoredForm = (): boolean =>
    this.shape.echoesStoredFormOnWrite && !this.writeEchoSuppressed;

  private toPushResult = (stored: StoredDestinationEvent): PushResult => {
    if (!this.echoesStoredForm()) {
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
      availability: event.availability ?? "busy",
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

interface CapturedBaseline {
  remoteAvailability: EventAvailability | null;
  remoteContentHash: string | null;
  remoteEndTime: Date | null;
  remoteStartTime: Date | null;
}

const recordedBaseline = (mappingStore: MappingStore): CapturedBaseline => {
  const [mapping] = mappingStore.read();
  if (!mapping) {
    throw new Error("expected exactly one mapping to be recorded");
  }
  return {
    remoteAvailability: mapping.remoteAvailability ?? null,
    remoteContentHash: mapping.remoteContentHash ?? null,
    remoteEndTime: mapping.remoteEndTime ?? null,
    remoteStartTime: mapping.remoteStartTime ?? null,
  };
};

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

const syncWithHealthyCapture = async (fixture: Fixture): Promise<CapturedBaseline> => {
  const { destination, mappingStore, provider } = fixture;
  await expect(reconcile(provider, destination, mappingStore, ORIGINAL_EVENT)).resolves.toMatchObject({
    added: 1,
    addFailed: 0,
    removeFailed: 0,
  });

  const baseline = recordedBaseline(mappingStore);
  expect(baseline).toEqual(destination.observedForms()[0]);
  return baseline;
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
  describe(`a failed capture preserves every recorded ${shape.name} baseline`, () => {
    it("records all four fields when the capture succeeds", async () => {
      const fixture = createFixture(shape);
      const baseline = await syncWithHealthyCapture(fixture);

      expect(baseline.remoteAvailability).toBe(LOCAL_AVAILABILITY);
      expect(baseline.remoteContentHash).toEqual(expect.any(String));
      expect(baseline.remoteStartTime).toEqual(ORIGINAL_EVENT.startTime);
      expect(baseline.remoteEndTime).toEqual(ORIGINAL_EVENT.endTime);
    });

    it("leaves all four intact when the capture read is throttled", async () => {
      const fixture = createFixture(shape);
      const baseline = await syncWithHealthyCapture(fixture);

      await rescheduleWithFailedCapture(fixture);

      expect(recordedBaseline(fixture.mappingStore)).toEqual(baseline);
    });

    it("takes the shape's own replacement path while doing so", async () => {
      const fixture = createFixture(shape);
      await syncWithHealthyCapture(fixture);

      await rescheduleWithFailedCapture(fixture);

      if (shape.supportsInPlaceUpdate) {
        expect(fixture.destination.updatedDeleteIds).toHaveLength(1);
        expect(fixture.destination.deletedIds).toEqual([]);
        return;
      }
      expect(fixture.destination.deletedIds).toHaveLength(1);
      expect(fixture.destination.pushedEventIds).toEqual([RESCHEDULED_EVENT.id]);
    });

    it("records the destination's real form again once the capture recovers", async () => {
      const fixture = createFixture(shape);
      await syncWithHealthyCapture(fixture);
      await rescheduleWithFailedCapture(fixture);

      fixture.destination.captureFails = false;
      fixture.destination.writeEchoSuppressed = false;
      fixture.destination.resetCalls();
      await reconcile(fixture.provider, fixture.destination, fixture.mappingStore, RESCHEDULED_EVENT);

      expect(recordedBaseline(fixture.mappingStore)).toEqual(fixture.destination.observedForms()[0]);
    });
  });
}

const KEPT_BASELINE_UPDATE: PendingUpdate = {
  deleteIdentifier: "remote-delete-1",
  endTime: new Date("2026-05-14T12:00:00.000Z"),
  id: "019c0000-0000-7000-8000-000000000001",
  remoteAvailability: null,
  remoteEndTime: null,
  remoteStartTime: null,
  startTime: new Date("2026-05-14T11:00:00.000Z"),
  syncEventHash: "hash-1",
  syncEventId: "sync-event-1",
};

const captureUpdateStatement = async (update: PendingUpdate): Promise<string> => {
  const dialect = new PgDialect();
  const statements: string[] = [];
  const fakeDatabase = {
    transaction: (callback: (transaction: unknown) => Promise<void>) => callback({
      delete: () => ({ where: () => Promise.resolve() }),
      execute: (query: SQL) => {
        statements.push(dialect.sqlToQuery(query).sql);
        return Promise.resolve();
      },
      insert: () => ({ values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }),
    }),
  };

  await createDatabaseFlush(fakeDatabase as never)({ deletes: [], inserts: [], updates: [update] });

  const [statement] = statements;
  if (!statement) {
    throw new Error("expected the flush to issue one batched update statement");
  }
  return statement;
};

describe("the batched mapping update keeps an unproven baseline", () => {
  it("coalesces all four recorded columns, not only the hash", async () => {
    const statement = await captureUpdateStatement(KEPT_BASELINE_UPDATE);

    for (const column of ["remoteContentHash", "remoteAvailability", "remoteStartTime", "remoteEndTime"]) {
      expect(statement).toContain(`coalesce(source."${column}", target."${column}")`);
    }
  });
});
