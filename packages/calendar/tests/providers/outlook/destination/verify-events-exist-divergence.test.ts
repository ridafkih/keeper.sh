import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookSyncProvider } from "../../../../src/providers/outlook/destination/provider";
import { identifyStaleMappings } from "../../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../../src/core/events/content-hash";
import type { EventMapping } from "../../../../src/core/events/mappings";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";

const DELETE_ID = "destination-event-id";
const START_TIME = new Date("2026-09-01T15:00:00.000Z");
const END_TIME = new Date("2026-09-01T16:00:00.000Z");

const createProvider = () =>
  createOutlookSyncProvider({
    accessToken: "test-token",
    refreshToken: "test-refresh",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    externalCalendarId: "external-cal-1",
    calendarId: "cal-1",
    userId: "user-1",
  });

const localEvent: MaterializedSyncableEvent = {
  availability: "busy",
  calendarId: "cal-1",
  calendarName: "Work",
  calendarUrl: null,
  description: "Original agenda",
  endTime: END_TIME,
  id: "sync-event-1",
  isAllDay: false,
  location: "Room A",
  sourceEventUid: "source-uid-1",
  startTime: START_TIME,
  summary: "Original title",
};

const mapping: EventMapping = {
  calendarId: "cal-1",
  deleteIdentifier: DELETE_ID,
  destinationEventUid: "ical-uid-1",
  endTime: END_TIME,
  eventStateId: null,
  id: "mapping-1",
  sourceCalendarId: null,
  startTime: START_TIME,
  syncEventHash: createSyncEventContentHash(localEvent),
  syncEventId: "sync-event-1",
};

const editedRemoteEvent = {
  body: { content: "Original agenda", contentType: "text" },
  categories: ["Keeper"],
  end: { dateTime: "2026-09-01T16:00:00Z", timeZone: "UTC" },
  iCalUId: "ical-uid-1",
  id: DELETE_ID,
  isAllDay: false,
  location: { displayName: "Room A" },
  showAs: "busy",
  start: { dateTime: "2026-09-01T15:00:00Z", timeZone: "UTC" },
  subject: "Title the user edited on the destination",
};

describe("a verified event still shows its divergence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a destination-side edit visible to staleness detection", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(editedRemoteEvent))));

    const [verifiedEvent] = await createProvider().verifyEventsExist([DELETE_ID]);
    expect(verifiedEvent).toBeDefined();
    if (!verifiedEvent) {
      return;
    }

    const result = identifyStaleMappings(
      [mapping],
      new Set(["sync-event-1"]),
      new Map([[mapping.id, verifiedEvent]]),
      new Map([["sync-event-1", localEvent]]),
    );

    expect(result.staleReasonCounts.remoteContentChanged).toBe(1);
    expect(result.staleReasonCounts.remoteContentSummaryChanged).toBe(1);
    expect(result.staleMappingIds).toEqual(["mapping-1"]);
  });
});
