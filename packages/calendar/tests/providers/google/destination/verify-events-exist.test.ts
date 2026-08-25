import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleSyncProvider } from "../../../../src/providers/google/destination/provider";
import { generateDeterministicEventUid } from "../../../../src/core/events/identity";
import type { BatchSubRequest, BatchSubResponse } from "../../../../src/providers/google/shared/batch";
import type { CalendarSyncProvider } from "../../../../src/core/sync-engine/types";
import type { RemoteEvent } from "../../../../src/core/types";

const batchMocks = vi.hoisted(() => ({
  executeBatchChunked: vi.fn(),
}));

vi.mock("../../../../src/providers/google/shared/batch", () => ({
  executeBatchChunked: batchMocks.executeBatchChunked,
}));

const EXTERNAL_CALENDAR_ID = "primary";
const EVENTS_PATH = `/calendar/v3/calendars/${encodeURIComponent(EXTERNAL_CALENDAR_ID)}/events`;
const PRESENT_EVENT_ID = "googleeventidpresent1";
const DELETED_EVENT_ID = "googleeventiddeleted1";
const FLAKY_EVENT_ID = "googleeventidflaky111";
const LEGACY_EVENT_ID = "googleeventidlegacy11";
/* A mapping written before deleteIdentifier existed holds the iCalUID, not the Google event id. */
const LEGACY_UID = generateDeterministicEventUid(`event-state-id-legacy:${EXTERNAL_CALENDAR_ID}`);
const PRESENT_UID = generateDeterministicEventUid(`event-state-id-present:${EXTERNAL_CALENDAR_ID}`);
const START_TIME = "2026-03-15T09:00:00.000Z";
const END_TIME = "2026-03-15T10:00:00.000Z";

interface EventPresence {
  event?: RemoteEvent;
  identifier: string;
  status: "absent" | "present" | "unknown";
}

const createProvider = (): CalendarSyncProvider => createGoogleSyncProvider({
  accessToken: "test-token",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  calendarId: "destination-calendar-id",
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

const googleResource = (eventId: string, uid: string) => ({
  end: { dateTime: END_TIME },
  iCalUID: uid,
  id: eventId,
  start: { dateTime: START_TIME },
  summary: "Weekly planning",
});

const batchResponse = (statusCode: number, body: unknown): BatchSubResponse => ({
  body,
  headers: {},
  statusCode,
});

const requestedPaths = (): string[] => {
  const [requests] = batchMocks.executeBatchChunked.mock.calls[0] as [BatchSubRequest[]];
  return requests.map((request) => request.path);
};

describe("Google destination verifyEventsExist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports present, positively absent, legacy-resolved and undetermined identifiers apart", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([
      batchResponse(200, googleResource(PRESENT_EVENT_ID, PRESENT_UID)),
      batchResponse(404, { error: { code: 404, message: "Not Found" } }),
      batchResponse(200, { items: [googleResource(LEGACY_EVENT_ID, LEGACY_UID)] }),
      batchResponse(503, { error: { code: 503, message: "Backend Error" } }),
    ]);

    const verify = verificationOf(createProvider());
    const presences = await verify([
      PRESENT_EVENT_ID,
      DELETED_EVENT_ID,
      LEGACY_UID,
      FLAKY_EVENT_ID,
    ]);

    expect(presences).toEqual([
      { event: expect.objectContaining({ deleteId: PRESENT_EVENT_ID, uid: PRESENT_UID }), identifier: PRESENT_EVENT_ID, status: "present" },
      { identifier: DELETED_EVENT_ID, status: "absent" },
      { event: expect.objectContaining({ deleteId: LEGACY_EVENT_ID, uid: LEGACY_UID }), identifier: LEGACY_UID, status: "present" },
      { identifier: FLAKY_EVENT_ID, status: "unknown" },
    ]);
  });

  it("resolves a legacy iCalUID identifier through the list query, never a by-id path", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([
      batchResponse(200, googleResource(PRESENT_EVENT_ID, PRESENT_UID)),
      batchResponse(200, { items: [googleResource(LEGACY_EVENT_ID, LEGACY_UID)] }),
    ]);

    const verify = verificationOf(createProvider());
    await verify([PRESENT_EVENT_ID, LEGACY_UID]);

    expect(batchMocks.executeBatchChunked).toHaveBeenCalledTimes(1);
    expect(requestedPaths()).toEqual([
      `${EVENTS_PATH}/${encodeURIComponent(PRESENT_EVENT_ID)}`,
      `${EVENTS_PATH}?iCalUID=${encodeURIComponent(LEGACY_UID)}`,
    ]);
  });

  it("reports an empty legacy lookup as absent and a refused legacy lookup as unknown", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([
      batchResponse(200, { items: [] }),
      batchResponse(429, { error: { code: 429, message: "Rate Limit Exceeded" } }),
    ]);

    const verify = verificationOf(createProvider());
    const presences = await verify([LEGACY_UID, PRESENT_UID]);

    expect(presences).toEqual([
      { identifier: LEGACY_UID, status: "absent" },
      { identifier: PRESENT_UID, status: "unknown" },
    ]);
  });

  it("reports a missing batch response as unknown rather than absent", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([]);

    const verify = verificationOf(createProvider());
    const presences = await verify([PRESENT_EVENT_ID]);

    expect(presences).toEqual([{ identifier: PRESENT_EVENT_ID, status: "unknown" }]);
  });
});
