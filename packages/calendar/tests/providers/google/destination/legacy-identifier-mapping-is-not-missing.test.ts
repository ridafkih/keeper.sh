import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeSyncOperations } from "../../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../../src/core/events/content-hash";
import { createGoogleSyncProvider } from "../../../../src/providers/google/destination/provider";
import { executeRemoteOperations } from "../../../../src/core/sync-engine/index";
import { generateDeterministicEventUid } from "../../../../src/core/events/identity";
import type { CalendarSyncProvider } from "../../../../src/core/sync-engine/types";
import type { EventMapping } from "../../../../src/core/events/mappings";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import type { BatchSubRequest, BatchSubResponse } from "../../../../src/providers/google/shared/batch";

const batchMocks = vi.hoisted(() => ({
  executeBatchChunked: vi.fn(),
}));

vi.mock("../../../../src/providers/google/shared/batch", () => ({
  executeBatchChunked: batchMocks.executeBatchChunked,
}));

const EXTERNAL_CALENDAR_ID = "primary";
const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const EVENTS_PATH = `/calendar/v3/calendars/${encodeURIComponent(EXTERNAL_CALENDAR_ID)}/events`;
const EVENT_STATE_ID = "event-state-id-1";
const LEGACY_UID = generateDeterministicEventUid(`${EVENT_STATE_ID}:${EXTERNAL_CALENDAR_ID}`);
const LIVE_GOOGLE_EVENT_ID = "googleeventidabc123";
const START_TIME = new Date("2026-03-15T09:00:00.000Z");
const END_TIME = new Date("2026-03-15T10:00:00.000Z");
const SUMMARY = "Weekly planning";

const WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

const localEvent: MaterializedSyncableEvent = {
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: END_TIME,
  id: EVENT_STATE_ID,
  sourceEventUid: "source-event-uid-1",
  startTime: START_TIME,
  summary: SUMMARY,
};

const legacyMapping: EventMapping = {
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: LEGACY_UID,
  destinationEventUid: LEGACY_UID,
  endTime: END_TIME,
  eventStateId: EVENT_STATE_ID,
  id: "mapping-id-1",
  sourceCalendarId: "source-calendar-id",
  startTime: START_TIME,
  syncEventHash: createSyncEventContentHash(localEvent),
  syncEventId: EVENT_STATE_ID,
};

interface GoogleResource {
  end: { dateTime: string };
  iCalUID: string;
  id: string;
  start: { dateTime: string };
  summary: string;
}

const createProvider = (): CalendarSyncProvider => createGoogleSyncProvider({
  accessToken: "test-token",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  calendarId: DESTINATION_CALENDAR_ID,
  externalCalendarId: EXTERNAL_CALENDAR_ID,
  refreshToken: "test-refresh",
  userId: "user-1",
});

const notFound = (): BatchSubResponse => ({
  body: { error: { code: 404, message: "Not Found" } },
  headers: {},
  statusCode: 404,
});

const createGoogleCalendarDouble = () => {
  const resourcesById = new Map<string, GoogleResource>([[
    LIVE_GOOGLE_EVENT_ID,
    {
      end: { dateTime: END_TIME.toISOString() },
      iCalUID: LEGACY_UID,
      id: LIVE_GOOGLE_EVENT_ID,
      start: { dateTime: START_TIME.toISOString() },
      summary: SUMMARY,
    },
  ]]);
  const requestLog: { method: string; path: string }[] = [];
  let importCount = 0;

  const handleGet = (path: string): BatchSubResponse => {
    const [basePath, query] = path.split("?");
    if (query?.startsWith("iCalUID=")) {
      const uid = decodeURIComponent(query.slice("iCalUID=".length));
      const items = [...resourcesById.values()].filter((resource) => resource.iCalUID === uid);
      return { body: { items }, headers: {}, statusCode: 200 };
    }
    const eventId = decodeURIComponent(basePath?.slice(`${EVENTS_PATH}/`.length) ?? "");
    const resource = resourcesById.get(eventId);
    if (!resource) {
      return notFound();
    }
    return { body: resource, headers: {}, statusCode: 200 };
  };

  const handleDelete = (path: string): BatchSubResponse => {
    const eventId = decodeURIComponent(path.slice(`${EVENTS_PATH}/`.length));
    if (!resourcesById.delete(eventId)) {
      return notFound();
    }
    return { body: null, headers: {}, statusCode: 204 };
  };

  const handleImport = (body: unknown): BatchSubResponse => {
    importCount += 1;
    const imported = body as { iCalUID: string; start: { dateTime: string }; end: { dateTime: string }; summary: string };
    const resource: GoogleResource = {
      end: imported.end,
      iCalUID: imported.iCalUID,
      id: `recreated-google-event-id-${importCount}`,
      start: imported.start,
      summary: imported.summary,
    };
    resourcesById.set(resource.id, resource);
    return { body: resource, headers: {}, statusCode: 200 };
  };

  const handle = (request: BatchSubRequest): BatchSubResponse => {
    requestLog.push({ method: request.method, path: request.path });
    if (request.method === "GET") {
      return handleGet(request.path);
    }
    if (request.method === "DELETE") {
      return handleDelete(request.path);
    }
    return handleImport(request.body);
  };

  const install = (): void => {
    batchMocks.executeBatchChunked.mockImplementation(
      (requests: BatchSubRequest[]) => Promise.resolve(requests.map((request) => handle(request))),
    );
  };

  return { install, requestLog, resourcesById };
};

describe("a mapping whose deleteIdentifier is a legacy iCalUID", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is matched by the targeted read instead of being deleted and recreated", async () => {
    const google = createGoogleCalendarDouble();
    google.install();
    const provider = createProvider();

    const lookUpByIds = provider.getRemoteEventsByIds;
    if (!lookUpByIds) {
      throw new Error("expected the Google destination provider to support targeted reads");
    }
    const remoteEvents = await lookUpByIds([legacyMapping.deleteIdentifier]);

    expect(remoteEvents.map((remoteEvent) => remoteEvent.uid)).toEqual([LEGACY_UID]);

    const { operations, staleReasonCounts } = computeSyncOperations(
      [localEvent],
      [legacyMapping],
      remoteEvents,
      {
        authoritativeMappingIds: new Set([legacyMapping.id]),
        authoritativeWindow: WINDOW,
        requestedWindow: WINDOW,
      },
    );

    expect(staleReasonCounts.remoteMissing).toBe(0);
    expect(operations).toEqual([]);

    await executeRemoteOperations(
      operations,
      [legacyMapping],
      DESTINATION_CALENDAR_ID,
      provider,
    );

    expect(google.requestLog.filter((entry) => entry.method === "DELETE")).toEqual([]);
    expect(google.requestLog.filter((entry) => entry.method === "POST")).toEqual([]);
    expect([...google.resourcesById.keys()]).toEqual([LIVE_GOOGLE_EVENT_ID]);
  });
});
