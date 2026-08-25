import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventMapping } from "../../src/core/events/mappings";
import type { MaterializedSyncableEvent } from "../../src/core/types";
import type { PendingChanges } from "../../src/core/sync-engine/types";
import { createOutlookSyncProvider } from "../../src/providers/outlook/destination/provider";
import { syncCalendar } from "../../src/core/sync-engine/index";

const SOURCE_CALENDAR_ID = "source-calendar";
const DESTINATION_CALENDAR_ID = "destination-calendar";
const EXTERNAL_CALENDAR_ID = "external-cal-1";
const DESCRIPTION_TEXT = "Team sync notes";

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
  description: DESCRIPTION_TEXT,
  endTime: new Date("2026-05-14T10:00:00.000Z"),
  id: "sync-event-1",
  location: "Meeting room",
  sourceEventUid: "source-uid-1",
  startTime: new Date("2026-05-14T09:00:00.000Z"),
  summary: "Weekly planning",
};

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
 * Stands in for Microsoft Graph: the create response echoes the body as HTML,
 * while every later read honours `Prefer: outlook.body-content-type="text"`.
 */
class FakeGraph {
  private nextId = 1;
  private readonly stored = new Map<string, Record<string, unknown> & GraphResource>();
  public readonly createdIds: string[] = [];
  public readonly deletedIds: string[] = [];

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

  public resetCalls = (): void => {
    this.createdIds.length = 0;
    this.deletedIds.length = 0;
  };

  private create = (init?: RequestInit): Response => {
    const sent: Record<string, unknown> = JSON.parse(String(init?.body ?? "{}"));
    const suffix = this.nextId;
    this.nextId += 1;
    const id = `outlook-event-${suffix}`;
    const iCalUId = `outlook-uid-${suffix}`;
    const sentBody = sent["body"] as GraphBody | undefined;
    const text = sentBody?.content ?? "";
    this.createdIds.push(id);
    this.stored.set(id, {
      ...sent,
      body: { content: text, contentType: "text" },
      iCalUId,
      id,
    });

    return Response.json({
      ...sent,
      body: { content: `<html><body><p>${text}</p></body></html>`, contentType: "html" },
      iCalUId,
      id,
    });
  };

  private remove = (url: URL): Response => {
    const id = url.pathname.split("/").at(-1) ?? "";
    this.deletedIds.push(id);
    this.stored.delete(id);

    return new Response(null, { status: 204 });
  };

  private readOne = (url: URL): Response => {
    const id = url.pathname.split("/").at(-1) ?? "";
    const event = this.stored.get(id);
    if (!event) {
      return new Response(null, { status: 404 });
    }

    return Response.json(event);
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
      if (existing) {
        this.mappings.set(update.id, { ...existing, ...update });
      }
    }

    return Promise.resolve();
  };
}

const createProvider = () =>
  createOutlookSyncProvider({
    accessToken: "test-token",
    accessTokenExpiresAt: new Date("2100-01-01T00:00:00.000Z"),
    calendarId: DESTINATION_CALENDAR_ID,
    externalCalendarId: EXTERNAL_CALENDAR_ID,
    refreshToken: "test-refresh",
    userId: "user-1",
  });

type OutlookProvider = ReturnType<typeof createProvider>;

const reconcile = (provider: OutlookProvider, mappingStore: MappingStore) =>
  syncCalendar({
    calendarId: DESTINATION_CALENDAR_ID,
    flush: mappingStore.flush,
    isCurrent: () => Promise.resolve(true),
    provider,
    readState: async () => ({
      existingMappings: mappingStore.read(),
      localEvents: [LOCAL_EVENT],
      remoteEvents: await provider.listRemoteEvents(TEST_RECONCILIATION_SCOPE.requestedWindow),
    }),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });

describe("an Outlook echo hash matches what reads observe", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records a provider form a later read of the unchanged event reproduces", async () => {
    const graph = new FakeGraph();
    vi.stubGlobal("fetch", vi.fn(graph.fetch));
    const provider = createProvider();
    const mappingStore = new MappingStore();

    await expect(reconcile(provider, mappingStore)).resolves.toMatchObject({ added: 1, removed: 0 });

    const [mapping] = mappingStore.read();
    expect(mapping?.remoteContentHash).toEqual(expect.any(String));

    const [observed] = await provider.getRemoteEventsByIds([mapping?.deleteIdentifier ?? ""]);
    expect(observed?.editableContent?.description).toBe(DESCRIPTION_TEXT);
    expect(mapping?.remoteContentHash).toBe(observed?.editableContentHash);
  });

  it("emits nothing on the reconcile after an HTML-bodied create echo", async () => {
    const graph = new FakeGraph();
    vi.stubGlobal("fetch", vi.fn(graph.fetch));
    const provider = createProvider();
    const mappingStore = new MappingStore();

    await expect(reconcile(provider, mappingStore)).resolves.toMatchObject({ added: 1, removed: 0 });
    expect(graph.createdIds).toHaveLength(1);

    graph.resetCalls();
    await expect(reconcile(provider, mappingStore)).resolves.toMatchObject({
      added: 0,
      addFailed: 0,
      removed: 0,
      removeFailed: 0,
    });
    expect(graph.createdIds).toEqual([]);
    expect(graph.deletedIds).toEqual([]);
  });
});
