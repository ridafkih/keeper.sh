import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEditableEventContentHash,
  createEditableEventContentSnapshot,
  hashEditableEventContentSnapshot,
} from "../../src/core/events/content-hash";
import type { EventMapping } from "../../src/core/events/mappings";
import type { PendingChanges } from "../../src/core/sync-engine/types";
import { createOutlookSyncProvider } from "../../src/providers/outlook/destination/provider";
import { syncCalendar } from "../../src/core/sync-engine/index";
import type {
  DeleteResult,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../../src/core/types";

const SOURCE_CALENDAR_ID = "source-calendar";
const DESTINATION_CALENDAR_ID = "destination-calendar";
const EXTERNAL_CALENDAR_ID = "external-cal-1";
const GOOGLE_DESCRIPTION_LIMIT = 8192;
const OVERLONG_DESCRIPTION = "A".repeat(9000);
const PARAGRAPHED_DESCRIPTION = "Agenda\n\nNotes";
const FLATTENED_DESCRIPTION = "Agenda\nNotes";

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

const buildLocalEvent = (description: string): MaterializedSyncableEvent => ({
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source calendar",
  calendarUrl: null,
  description,
  endTime: new Date("2026-05-14T10:00:00.000Z"),
  id: "sync-event-1",
  location: "Meeting room",
  sourceEventUid: "source-uid-1",
  startTime: new Date("2026-05-14T09:00:00.000Z"),
  summary: "Weekly planning",
});

interface StoredDestinationEvent {
  description: string;
  endTime: Date;
  location: string;
  startTime: Date;
  summary: string;
  uid: string;
}

const toContentSnapshot = (stored: StoredDestinationEvent) =>
  createEditableEventContentSnapshot({
    description: stored.description,
    location: stored.location,
    summary: stored.summary,
  });

const contentHashFor = (stored: StoredDestinationEvent): string =>
  hashEditableEventContentSnapshot(toContentSnapshot(stored));

const toRemoteEvent = (stored: StoredDestinationEvent): RemoteEvent => ({
  deleteId: stored.uid,
  editableAvailability: "busy",
  editableContent: toContentSnapshot(stored),
  editableContentHash: contentHashFor(stored),
  endTime: stored.endTime,
  isKeeperEvent: true,
  startTime: stored.startTime,
  supportedAvailabilities: ["busy", "free"],
  uid: stored.uid,
});

interface DestinationShape {
  normalizeDescription: (description: string) => string;
  remoteIdFor: (uid: string) => string;
}

/*
 * Google-shaped: the import echo carries the truncated description, and the mapping's
 * remote identifier is the iCalUID while the delete identifier is the event id.
 */
const GOOGLE_SHAPE: DestinationShape = {
  normalizeDescription: (description) => description.slice(0, GOOGLE_DESCRIPTION_LIMIT),
  remoteIdFor: (uid) => `${uid}-ical`,
};

/* Outlook-shaped: the create echo carries the body Graph flattened out of HTML. */
const OUTLOOK_SHAPE: DestinationShape = {
  normalizeDescription: (description) => description.replaceAll(/\n{2,}/g, "\n"),
  remoteIdFor: (uid) => uid,
};

/*
 * Both echoing destinations hand back the WHOLE form they actually stored, so the engine
 * owes no read-back: that echo is the baseline. Neither stored form equals the sent form, so a
 * recorded hash can only be right if it came from the echo. A partial echo would not do -- the
 * engine spends the read it replaces unless the times and availability come with it.
 */
class EchoingDestination {
  private readonly shape: DestinationShape;
  private readonly stored = new Map<string, StoredDestinationEvent>();
  public lookupCalls = 0;

  public constructor(shape: DestinationShape) {
    this.shape = shape;
  }

  public pushEvents = (events: MaterializedSyncableEvent[]): Promise<PushResult[]> =>
    Promise.resolve(events.map((event): PushResult => {
      const uid = `echo-uid-${event.id}`;
      const stored: StoredDestinationEvent = {
        description: this.shape.normalizeDescription(event.description ?? ""),
        endTime: event.endTime,
        location: event.location ?? "",
        startTime: event.startTime,
        summary: event.summary,
        uid,
      };
      this.stored.set(uid, stored);

      return {
        deleteId: uid,
        remoteId: this.shape.remoteIdFor(uid),
        storedAvailability: toRemoteEvent(stored).editableAvailability,
        storedContentHash: contentHashFor(stored),
        storedEndTime: stored.endTime,
        storedStartTime: stored.startTime,
        success: true,
      };
    }));

  public deleteEvents = (deleteIds: string[]): Promise<DeleteResult[]> =>
    Promise.resolve(deleteIds.map((deleteId): DeleteResult => {
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
        matched.push(toRemoteEvent(stored));
      }
    }
    return Promise.resolve(matched);
  };

  public snapshot = (): RemoteEvent[] =>
    [...this.stored.values()].map((stored) => toRemoteEvent(stored));

  public storedHashFor = (uid: string): string => {
    const stored = this.stored.get(uid);
    if (!stored) {
      throw new Error(`No stored event for ${uid}`);
    }
    return contentHashFor(stored);
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
  destination: EchoingDestination,
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

interface GraphBody {
  content: string;
  contentType: string;
}

interface GraphResource {
  body?: GraphBody | null;
  iCalUId: string;
  id: string;
}

/*
 * Stands in for Microsoft Graph honouring `Prefer: outlook.body-content-type="text"`
 * on the create as well as on reads, so the create echo is already the stored form.
 */
class TextEchoingGraph {
  private nextId = 1;
  private readonly stored = new Map<string, Record<string, unknown> & GraphResource>();
  public singleEventReads = 0;

  public fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";

    if (method === "POST") {
      return Promise.resolve(this.create(init));
    }
    if (method === "DELETE") {
      return Promise.resolve(this.remove(url));
    }
    if (url.pathname.includes("/calendars/")) {
      return Promise.resolve(Response.json({ value: [...this.stored.values()] }));
    }
    return Promise.resolve(this.readOne(url));
  };

  private create = (init?: RequestInit): Response => {
    const sent: Record<string, unknown> = JSON.parse(String(init?.body ?? "{}"));
    const suffix = this.nextId;
    this.nextId += 1;
    const id = `outlook-event-${suffix}`;
    const iCalUId = `outlook-uid-${suffix}`;
    const sentBody = sent["body"] as GraphBody | undefined;
    const text = (sentBody?.content ?? "").replaceAll(/\n{2,}/g, "\n");
    const resource = { ...sent, body: { content: text, contentType: "text" }, iCalUId, id };
    this.stored.set(id, resource);

    return Response.json(resource);
  };

  private remove = (url: URL): Response => {
    const id = url.pathname.split("/").at(-1) ?? "";
    this.stored.delete(id);

    return new Response(null, { status: 204 });
  };

  private readOne = (url: URL): Response => {
    this.singleEventReads += 1;
    const id = url.pathname.split("/").at(-1) ?? "";
    const event = this.stored.get(id);
    if (!event) {
      return new Response(null, { status: 404 });
    }

    return Response.json(event);
  };
}

const createOutlookProvider = () =>
  createOutlookSyncProvider({
    accessToken: "test-token",
    accessTokenExpiresAt: new Date("2100-01-01T00:00:00.000Z"),
    calendarId: DESTINATION_CALENDAR_ID,
    externalCalendarId: EXTERNAL_CALENDAR_ID,
    refreshToken: "test-refresh",
    userId: "user-1",
  });

const reconcileOutlook = (
  provider: ReturnType<typeof createOutlookProvider>,
  mappingStore: MappingStore,
) =>
  syncCalendar({
    calendarId: DESTINATION_CALENDAR_ID,
    flush: mappingStore.flush,
    isCurrent: () => Promise.resolve(true),
    provider,
    readState: async () => ({
      existingMappings: mappingStore.read(),
      localEvents: [buildLocalEvent(PARAGRAPHED_DESCRIPTION)],
      remoteEvents: await provider.listRemoteEvents(TEST_RECONCILIATION_SCOPE.requestedWindow),
    }),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });

describe("an echoed stored hash is recorded", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records the Google echo as the baseline without spending a lookup", async () => {
    const destination = new EchoingDestination(GOOGLE_SHAPE);
    const mappingStore = new MappingStore();

    await expect(reconcile(destination, mappingStore, buildLocalEvent(OVERLONG_DESCRIPTION)))
      .resolves.toMatchObject({ added: 1, addFailed: 0 });

    const [mapping] = mappingStore.read();
    expect(mapping?.remoteContentHash).toBe(destination.storedHashFor("echo-uid-sync-event-1"));
    expect(destination.lookupCalls).toBe(0);
  });

  it("records the Outlook echo as the baseline without spending a lookup", async () => {
    const destination = new EchoingDestination(OUTLOOK_SHAPE);
    const mappingStore = new MappingStore();

    await expect(reconcile(destination, mappingStore, buildLocalEvent(PARAGRAPHED_DESCRIPTION)))
      .resolves.toMatchObject({ added: 1, addFailed: 0 });

    const [mapping] = mappingStore.read();
    expect(mapping?.remoteContentHash).toBe(destination.storedHashFor("echo-uid-sync-event-1"));
    expect(destination.lookupCalls).toBe(0);
  });

  it("records the provider's own form rather than the form that was sent", async () => {
    const destination = new EchoingDestination(GOOGLE_SHAPE);
    const mappingStore = new MappingStore();
    const localEvent = buildLocalEvent(OVERLONG_DESCRIPTION);

    await reconcile(destination, mappingStore, localEvent);

    const [mapping] = mappingStore.read();
    expect(mapping?.remoteContentHash).toEqual(expect.any(String));
    expect(mapping?.remoteContentHash).not.toBe(createEditableEventContentHash(localEvent));
  });

  it("records the create echo from a real Outlook provider with no read-back", async () => {
    const graph = new TextEchoingGraph();
    vi.stubGlobal("fetch", vi.fn(graph.fetch));
    const provider = createOutlookProvider();
    const mappingStore = new MappingStore();

    await expect(reconcileOutlook(provider, mappingStore)).resolves.toMatchObject({ added: 1 });
    expect(graph.singleEventReads).toBe(0);

    const [mapping] = mappingStore.read();
    const [observed] = await provider.getRemoteEventsByIds([mapping?.deleteIdentifier ?? ""]);
    expect(observed?.editableContent?.description).toBe(FLATTENED_DESCRIPTION);
    expect(mapping?.remoteContentHash).toBe(observed?.editableContentHash);
  });
});
