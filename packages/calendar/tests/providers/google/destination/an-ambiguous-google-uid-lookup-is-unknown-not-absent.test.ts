import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeSyncOperations } from "../../../../src/core/sync/operations";
import { createGoogleSyncProvider } from "../../../../src/providers/google/destination/provider";
import { createSyncEventContentHash } from "../../../../src/core/events/content-hash";
import { executeRemoteOperations } from "../../../../src/core/sync-engine/index";
import { generateDeterministicEventUid } from "../../../../src/core/events/identity";
import type { BatchSubRequest, BatchSubResponse } from "../../../../src/providers/google/shared/batch";
import type { CalendarSyncProvider } from "../../../../src/core/sync-engine/types";
import type { EventMapping } from "../../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, RemoteEvent } from "../../../../src/core/types";

const batchMocks = vi.hoisted(() => ({
  executeBatchChunked: vi.fn(),
}));

vi.mock("../../../../src/providers/google/shared/batch", () => ({
  executeBatchChunked: batchMocks.executeBatchChunked,
}));

const EXTERNAL_CALENDAR_ID = "primary";
const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const EVENTS_PATH = `/calendar/v3/calendars/${encodeURIComponent(EXTERNAL_CALENDAR_ID)}/events`;
const IMPORT_PATH = `${EVENTS_PATH}/import`;
const EVENT_STATE_ID = "event-state-id-1";
/* A row written before deleteIdentifier existed holds the iCalUID, so verification takes the
   legacy ?iCalUID= path -- the only path that can answer with more than one item. */
const LEGACY_UID = generateDeterministicEventUid(`${EVENT_STATE_ID}:${EXTERNAL_CALENDAR_ID}`);
/* Google's ?iCalUID= list is over instances by default (singleEvents is false here, and no
   showDeleted), and every occurrence of a recurring series carries the master's iCalUID: a
   cancelled instance and its live master come back together, in unspecified order. */
const MASTER_EVENT_ID = "googleeventidmaster11";
const CANCELLED_INSTANCE_EVENT_ID = "googleeventidmaster11_20260315T090000Z";
const LIVE_INSTANCE_EVENT_ID = "googleeventidfirstone";
const START_TIME = new Date("2026-03-15T09:00:00.000Z");
const END_TIME = new Date("2026-03-15T10:00:00.000Z");
const SUMMARY = "Weekly planning";

const WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

interface EventPresence {
  event?: RemoteEvent;
  identifier: string;
  status: "absent" | "present" | "unknown";
}

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

const createProvider = (): CalendarSyncProvider => createGoogleSyncProvider({
  accessToken: "test-token",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  calendarId: DESTINATION_CALENDAR_ID,
  externalCalendarId: EXTERNAL_CALENDAR_ID,
  refreshToken: "test-refresh",
  userId: "user-1",
});

const verificationOf = (provider: CalendarSyncProvider) => {
  if (!provider.verifyEventsExist) {
    throw new Error("Google destination provider does not implement verifyEventsExist");
  }
  return provider.verifyEventsExist as unknown as (identifiers: string[]) => Promise<EventPresence[]>;
};

const liveMaster = () => ({
  end: { dateTime: END_TIME.toISOString() },
  iCalUID: LEGACY_UID,
  id: MASTER_EVENT_ID,
  recurrence: ["RRULE:FREQ=WEEKLY;COUNT=12"],
  start: { dateTime: START_TIME.toISOString() },
  status: "confirmed",
  summary: SUMMARY,
});

const cancelledInstance = () => ({
  iCalUID: LEGACY_UID,
  id: CANCELLED_INSTANCE_EVENT_ID,
  status: "cancelled",
});

const liveInstance = () => ({
  end: { dateTime: END_TIME.toISOString() },
  iCalUID: LEGACY_UID,
  id: LIVE_INSTANCE_EVENT_ID,
  start: { dateTime: START_TIME.toISOString() },
  status: "confirmed",
  summary: SUMMARY,
});

const batchResponse = (statusCode: number, body: unknown): BatchSubResponse => ({
  body,
  headers: {},
  statusCode,
});

describe("an ambiguous Google iCalUID lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is not absent when a cancelled instance is listed ahead of the live master", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([
      batchResponse(200, { items: [cancelledInstance(), liveMaster()] }),
    ]);

    const verify = verificationOf(createProvider());
    const [presence] = await verify([LEGACY_UID]);

    expect(presence).toEqual({ identifier: LEGACY_UID, status: "unknown" });
  });

  it("is unknown, and hands back no event, when two live entries share the uid", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([
      batchResponse(200, { items: [liveInstance(), liveMaster()] }),
    ]);

    const verify = verificationOf(createProvider());
    const [presence] = await verify([LEGACY_UID]);

    expect(presence?.status).toBe("unknown");
    expect(presence?.event).toBeUndefined();
  });

  it("still reports a single live match as present and an empty list as absent", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([
      batchResponse(200, { items: [liveMaster()] }),
      batchResponse(200, { items: [] }),
    ]);

    const verify = verificationOf(createProvider());
    const presences = await verify([LEGACY_UID, LEGACY_UID]);

    expect(presences).toEqual([
      {
        event: expect.objectContaining({ deleteId: MASTER_EVENT_ID, uid: LEGACY_UID }),
        identifier: LEGACY_UID,
        status: "present",
      },
      { identifier: LEGACY_UID, status: "absent" },
    ]);
  });
});

/* Google's own shape: the ?iCalUID= list answers with every occurrence sharing the uid, a get by
   event id answers the stored resource, and import is an upsert on the uid that flattens whatever
   series already wears it. */
const createGoogleCalendarDouble = () => {
  const requestLog: { body?: unknown; method: string; path: string }[] = [];

  const handleGet = (path: string): BatchSubResponse => {
    const [basePath, query] = path.split("?");
    if (query?.startsWith("iCalUID=")) {
      const uid = decodeURIComponent(query.slice("iCalUID=".length));
      if (uid !== LEGACY_UID) {
        return batchResponse(200, { items: [] });
      }
      return batchResponse(200, { items: [cancelledInstance(), liveMaster()] });
    }
    const eventId = decodeURIComponent(basePath?.slice(`${EVENTS_PATH}/`.length) ?? "");
    if (eventId !== MASTER_EVENT_ID) {
      return batchResponse(404, { error: { code: 404, message: "Not Found" } });
    }
    return batchResponse(200, liveMaster());
  };

  const handle = (request: BatchSubRequest): BatchSubResponse => {
    requestLog.push({ body: request.body, method: request.method, path: request.path });
    if (request.method === "GET") {
      return handleGet(request.path);
    }
    if (request.method === "DELETE") {
      return batchResponse(204, null);
    }
    return batchResponse(200, {
      end: { dateTime: END_TIME.toISOString() },
      iCalUID: LEGACY_UID,
      id: "recreated-google-event-id-1",
      start: { dateTime: START_TIME.toISOString() },
      status: "confirmed",
      summary: SUMMARY,
    });
  };

  const install = (): void => {
    batchMocks.executeBatchChunked.mockImplementation(
      (requests: BatchSubRequest[]) => Promise.resolve(requests.map((request) => handle(request))),
    );
  };

  return { install, requestLog };
};

describe("a run whose verification read is ambiguous", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("imports nothing over the live recurring master", async () => {
    const google = createGoogleCalendarDouble();
    google.install();
    const provider = createProvider();

    const { operations, staleReasonCounts } = computeSyncOperations(
      [localEvent],
      [legacyMapping],
      [],
      {
        authoritativeMappingIds: new Set([legacyMapping.id]),
        authoritativeWindow: WINDOW,
        requestedWindow: WINDOW,
      },
    );

    expect(staleReasonCounts.remoteMissing).toBe(1);

    const outcome = await executeRemoteOperations(
      operations,
      [legacyMapping],
      DESTINATION_CALENDAR_ID,
      provider,
    );

    expect(google.requestLog.filter((entry) => entry.path === IMPORT_PATH)).toEqual([]);
    expect(outcome.result.added).toBe(0);
  });
});
