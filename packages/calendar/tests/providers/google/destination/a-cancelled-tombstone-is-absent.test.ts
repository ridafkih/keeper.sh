import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleSyncProvider } from "../../../../src/providers/google/destination/provider";
import { computeSyncOperations } from "../../../../src/core/sync/operations";
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
const MIRROR_EVENT_ID = "googleeventidmirror11";
const MIRROR_UID = generateDeterministicEventUid(`ev-1:${EXTERNAL_CALENDAR_ID}`);
const RECREATED_EVENT_ID = "googleeventidrestored";
const START_TIME = new Date("2026-03-15T09:00:00.000Z");
const END_TIME = new Date("2026-03-15T10:00:00.000Z");

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

interface EventPresence {
  event?: RemoteEvent;
  identifier: string;
  status: "absent" | "present" | "unknown";
}

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

const readByIdsOf = (provider: CalendarSyncProvider) => {
  if (!provider.getRemoteEventsByIds) {
    throw new Error("Google destination provider does not implement getRemoteEventsByIds");
  }
  return provider.getRemoteEventsByIds;
};

const batchResponse = (statusCode: number, body: unknown): BatchSubResponse => ({
  body,
  headers: {},
  statusCode,
});

/* Google answers events.get for an event the recipient deleted with HTTP 200 and a tombstone: the
   resource is still returned, carrying status "cancelled". It never 404s. */
const fullCancelledResource = () => ({
  end: { dateTime: END_TIME.toISOString() },
  iCalUID: MIRROR_UID,
  id: MIRROR_EVENT_ID,
  start: { dateTime: START_TIME.toISOString() },
  status: "cancelled",
  summary: "Team lunch",
});

/* Google prunes a long-deleted event down to little more than its id and its cancelled status. */
const minimalTombstone = () => ({
  id: MIRROR_EVENT_ID,
  status: "cancelled",
});

const makeEvent = (): MaterializedSyncableEvent => ({
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
  endTime: END_TIME,
  id: "ev-1",
  sourceEventUid: "uid-ev-1",
  startTime: START_TIME,
  summary: "Team lunch",
});

const makeMapping = (event: MaterializedSyncableEvent): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: MIRROR_EVENT_ID,
  destinationEventUid: MIRROR_UID,
  endTime: END_TIME,
  eventStateId: event.id,
  id: "map-1",
  sourceCalendarId: "cal-1",
  startTime: START_TIME,
  syncEventHash: createSyncEventContentHash(event),
  syncEventId: event.id,
});

const planMissingMirrorReplacement = (event: MaterializedSyncableEvent, mapping: EventMapping) => {
  // A windowed listing never enumerates a cancelled tombstone, so reconciliation calls it missing.
  const { operations } = computeSyncOperations([event], [mapping], [], TEST_RECONCILIATION_SCOPE);
  expect(operations).toHaveLength(1);
  const [replacement] = operations;
  expect(replacement?.type === "replace" && replacement.remoteMissing).toBe(true);
  return operations;
};

const importedPaths = (): string[] => {
  const paths: string[] = [];
  for (const call of batchMocks.executeBatchChunked.mock.calls) {
    const [requests] = call as [BatchSubRequest[]];
    for (const request of requests) {
      if (request.method === "POST") {
        paths.push(request.path);
      }
    }
  }
  return paths;
};

describe("Google treats a cancelled tombstone as absent", () => {
  beforeEach(() => {
    // A queued-but-unconsumed response must never leak into the next test.
    batchMocks.executeBatchChunked.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports a full cancelled resource absent", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([batchResponse(200, fullCancelledResource())]);

    const presences = await verificationOf(createProvider())([MIRROR_EVENT_ID]);

    expect(presences).toEqual([{ identifier: MIRROR_EVENT_ID, status: "absent" }]);
  });

  it("reports a minimal cancelled tombstone absent", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([batchResponse(200, minimalTombstone())]);

    const presences = await verificationOf(createProvider())([MIRROR_EVENT_ID]);

    expect(presences).toEqual([{ identifier: MIRROR_EVENT_ID, status: "absent" }]);
  });

  it("reports a cancelled tombstone returned by a legacy iCalUID lookup absent", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([
      batchResponse(200, { items: [fullCancelledResource()] }),
    ]);

    const presences = await verificationOf(createProvider())([MIRROR_UID]);

    expect(presences).toEqual([{ identifier: MIRROR_UID, status: "absent" }]);
  });

  it.each([
    ["a full cancelled resource", fullCancelledResource],
    ["a minimal cancelled tombstone", minimalTombstone],
  ])("recreates the mirror when the verification read returns %s", async (_label, tombstone) => {
    batchMocks.executeBatchChunked
      .mockResolvedValueOnce([batchResponse(200, tombstone())])
      .mockResolvedValueOnce([batchResponse(200, { id: RECREATED_EVENT_ID })]);

    const event = makeEvent();
    const mapping = makeMapping(event);

    const outcome = await executeRemoteOperations(
      planMissingMirrorReplacement(event, mapping),
      [mapping],
      DESTINATION_CALENDAR_ID,
      createProvider(),
    );

    expect(importedPaths()).toEqual([`${EVENTS_PATH}/import`]);
    expect(outcome.result.added).toBe(1);
    expect(outcome.result.addFailed).toBe(0);
    expect(outcome.changes.inserts.map((insert) => insert.deleteIdentifier)).toEqual([RECREATED_EVENT_ID]);
  });

  it.each([
    ["a full cancelled resource", fullCancelledResource],
    ["a minimal cancelled tombstone", minimalTombstone],
  ])("never hands the engine %s as a remote event", async (_label, tombstone) => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([batchResponse(200, tombstone())]);

    const remoteEvents = await readByIdsOf(createProvider())([MIRROR_EVENT_ID]);

    expect(remoteEvents).toEqual([]);
  });

  it("never lists a cancelled tombstone among the remote events reconciliation sees", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json({
      items: [fullCancelledResource()],
    }, { status: 200 }))));

    const remoteEvents = await createProvider().listRemoteEvents({
      timeMax: new Date("2099-01-01T00:00:00.000Z"),
      timeMin: new Date("2026-03-01T00:00:00.000Z"),
    });

    expect(remoteEvents).toEqual([]);
  });
});
