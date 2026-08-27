import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleSyncProvider } from "../../src/providers/google/destination/provider";
import { createOutlookSyncProvider } from "../../src/providers/outlook/destination/provider";
import { executeRemoteOperations } from "../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../src/core/events/content-hash";
import type { EventMapping } from "../../src/core/events/mappings";
import type { CalendarSyncProvider, PendingUpdate } from "../../src/core/sync-engine/types";
import type { MaterializedSyncableEvent, SyncOperation } from "../../src/core/types";

const batchMocks = vi.hoisted(() => ({
  executeBatchChunked: vi.fn(),
}));

vi.mock("../../src/providers/google/shared/batch", () => ({
  executeBatchChunked: batchMocks.executeBatchChunked,
}));

interface SubRequest {
  method: string;
  path: string;
  body?: unknown;
}

interface SubResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

type StoredEvent = Record<string, unknown>;

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const GOOGLE_EVENT_ID = "google-event-id-abc123";
const GOOGLE_ICAL_UID = "0123456789abcdef0123456789abcdef@keeper.sh";
const OUTLOOK_EVENT_ID = "AAMkAGViNDU3OWQzLWRlLTQ0";
const OUTLOOK_ICAL_UID = "outlook-ical-uid-1@keeper.sh";
const STALE_DESCRIPTION = "Bring the printed deck";
const STALE_LOCATION = "Room 4, third floor";

const SYNC_WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

const RECONCILIATION_SCOPE = {
  authoritativeWindow: SYNC_WINDOW,
  requestedWindow: SYNC_WINDOW,
};

const clearedEvent: MaterializedSyncableEvent = {
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00.000Z"),
  id: "event-state-id-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-03-15T09:00:00.000Z"),
  summary: "Meeting",
};

const beforeClearHash = createSyncEventContentHash({
  ...clearedEvent,
  description: STALE_DESCRIPTION,
  location: STALE_LOCATION,
});

const makeMapping = (destinationEventUid: string, deleteIdentifier: string): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier,
  destinationEventUid,
  endTime: clearedEvent.endTime,
  eventStateId: clearedEvent.id,
  id: "map-1",
  sourceCalendarId: clearedEvent.calendarId,
  startTime: clearedEvent.startTime,
  syncEventHash: beforeClearHash,
  syncEventId: clearedEvent.id,
});

const applyMappingUpdate = (mapping: EventMapping, update: PendingUpdate): EventMapping => ({
  ...mapping,
  deleteIdentifier: update.deleteIdentifier,
  destinationEventUid: update.destinationEventUid ?? mapping.destinationEventUid,
  endTime: update.endTime,
  startTime: update.startTime,
  syncEventHash: update.syncEventHash,
  syncEventId: update.syncEventId,
});

const overTheWire = (body: unknown): Record<string, unknown> => {
  const wireText = JSON.stringify(body ?? {});
  const encoded: unknown = JSON.parse(wireText);
  if (typeof encoded !== "object" || encoded === null) {
    return {};
  }
  return { ...encoded };
};

const writeSentKeys = (base: StoredEvent, sent: Record<string, unknown>): StoredEvent => {
  const written: StoredEvent = { ...base };
  for (const [key, value] of Object.entries(sent)) {
    if (value === null) {
      continue;
    }
    written[key] = value;
  }
  return written;
};

const mergeIntoStored = (stored: StoredEvent, sent: Record<string, unknown>): StoredEvent => {
  const kept: StoredEvent = {};
  for (const [key, value] of Object.entries(stored)) {
    if (key in sent) {
      continue;
    }
    kept[key] = value;
  }
  return writeSentKeys(kept, sent);
};

const replaceStored = (immutable: StoredEvent, sent: Record<string, unknown>): StoredEvent =>
  writeSentKeys(immutable, sent);

const createGoogleStore = () => {
  let stored: StoredEvent = {
    description: STALE_DESCRIPTION,
    end: { dateTime: "2026-03-15T10:00:00.000Z" },
    iCalUID: GOOGLE_ICAL_UID,
    id: GOOGLE_EVENT_ID,
    location: STALE_LOCATION,
    start: { dateTime: "2026-03-15T09:00:00.000Z" },
    summary: "Meeting",
  };

  const nextGoogleState = (method: string, sent: Record<string, unknown>): StoredEvent => {
    if (method === "PATCH") {
      return mergeIntoStored(stored, sent);
    }
    return replaceStored({ iCalUID: GOOGLE_ICAL_UID, id: GOOGLE_EVENT_ID }, sent);
  };

  const handleBatch = (request: SubRequest): SubResponse => {
    stored = nextGoogleState(request.method, overTheWire(request.body));
    return { body: { ...stored }, headers: {}, statusCode: 200 };
  };

  const handleList = (): Response => Response.json({ items: [{ ...stored }] });

  return { handleBatch, handleList, read: () => stored };
};

const createOutlookStore = () => {
  let stored: StoredEvent = {
    body: { content: STALE_DESCRIPTION, contentType: "text" },
    categories: ["keeper.sh"],
    end: { dateTime: "2026-03-15T10:00:00.0000000", timeZone: "UTC" },
    iCalUId: OUTLOOK_ICAL_UID,
    id: OUTLOOK_EVENT_ID,
    isAllDay: false,
    location: { displayName: STALE_LOCATION },
    showAs: "busy",
    start: { dateTime: "2026-03-15T09:00:00.0000000", timeZone: "UTC" },
    subject: "Meeting",
  };

  const nextOutlookState = (method: string, sent: Record<string, unknown>): StoredEvent => {
    if (method === "PATCH") {
      return mergeIntoStored(stored, sent);
    }
    return replaceStored({ iCalUId: OUTLOOK_ICAL_UID, id: OUTLOOK_EVENT_ID }, sent);
  };

  const handle = (init: RequestInit): Response => {
    const method = String(init.method);
    if (method === "GET") {
      return Response.json({ value: [{ ...stored }] });
    }
    const parsedBody: unknown = JSON.parse(String(init.body));
    stored = nextOutlookState(method, overTheWire(parsedBody));
    return Response.json({ ...stored });
  };

  return { handle, read: () => stored };
};

const createGoogleProvider = (): CalendarSyncProvider => createGoogleSyncProvider({
  accessToken: "test-token",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  calendarId: DESTINATION_CALENDAR_ID,
  externalCalendarId: "primary",
  refreshToken: "test-refresh",
  userId: "user-1",
});

const createOutlookProvider = (): CalendarSyncProvider => createOutlookSyncProvider({
  accessToken: "test-token",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  calendarId: DESTINATION_CALENDAR_ID,
  externalCalendarId: "external-cal-1",
  refreshToken: "test-refresh",
  userId: "user-1",
});

const reconcile = async (
  provider: CalendarSyncProvider,
  mapping: EventMapping,
): Promise<SyncOperation[]> => {
  const remoteEvents = await provider.listRemoteEvents(SYNC_WINDOW);
  const { operations } = computeSyncOperations(
    [clearedEvent],
    [mapping],
    remoteEvents,
    RECONCILIATION_SCOPE,
  );
  return operations;
};

const settleOneReplacement = async (
  provider: CalendarSyncProvider,
  mapping: EventMapping,
): Promise<EventMapping> => {
  const operations = await reconcile(provider, mapping);
  expect(operations.map((operation) => operation.type)).toEqual(["replace"]);

  const outcome = await executeRemoteOperations(
    operations,
    [mapping],
    DESTINATION_CALENDAR_ID,
    provider,
  );

  expect(outcome.errors).toEqual([]);
  const update = outcome.changes.updates?.[0];
  if (!update) {
    throw new Error("Expected the in-place update to rewrite the mapping");
  }
  return applyMappingUpdate(mapping, update);
};

describe("a cleared field does not loop forever", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stops replacing the Google mirror once the cleared fields have landed", async () => {
    const store = createGoogleStore();
    batchMocks.executeBatchChunked.mockImplementation(
      (requests: SubRequest[]) =>
        Promise.resolve(requests.map((request) => store.handleBatch(request))),
    );
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(store.handleList())));

    const provider = createGoogleProvider();
    const settled = await settleOneReplacement(
      provider,
      makeMapping(GOOGLE_ICAL_UID, GOOGLE_EVENT_ID),
    );

    expect(await reconcile(provider, settled)).toEqual([]);
  });

  it("stops replacing the Outlook mirror once the cleared fields have landed", async () => {
    const store = createOutlookStore();
    vi.stubGlobal("fetch", vi.fn((_input: string | URL, init: RequestInit) =>
      Promise.resolve(store.handle(init))));

    const provider = createOutlookProvider();
    const settled = await settleOneReplacement(
      provider,
      makeMapping(OUTLOOK_ICAL_UID, OUTLOOK_EVENT_ID),
    );

    expect(await reconcile(provider, settled)).toEqual([]);
  });
});
