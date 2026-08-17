import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookSyncProvider } from "../../../../src/providers/outlook/destination/provider";
import { createGoogleSyncProvider } from "../../../../src/providers/google/destination/provider";
import { classifyInboundChanges } from "../../../../src/core/sync/write-back";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
  normalizeText,
} from "../../../../src/core/events/content-hash";
import { resolveIsAllDayEvent } from "../../../../src/core/events/all-day";
import type { EventMapping } from "../../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, RemoteEvent } from "../../../../src/core/types";
import type { ReconciliationScope } from "../../../../src/core/sync/operations";

const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const SOURCE_CALENDAR_ID = "source-calendar-id";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const NOW = new Date("2027-05-01T12:00:00.000Z");

const TEST_WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

const createLocalEvent = (): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Personal",
  calendarUrl: null,
  description: "Bring the notes",
  endTime: END_TIME,
  eventStateId: "event-1",
  id: "event-1",
  location: "Room 4",
  sourceEventUid: "source-event-uid-1",
  startTime: START_TIME,
  summary: "Quarterly review",
});

const createMapping = (event: MaterializedSyncableEvent): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: "destination-delete-id",
  destinationAvailability: "busy",
  destinationContentHash: createEditableEventContentHash(event),
  destinationDescription: normalizeText(event.description),
  destinationEndTime: event.endTime,
  destinationEventUid: "destination-uid-1",
  destinationIsAllDay: resolveIsAllDayEvent({
    endTime: event.endTime,
    startTime: event.startTime,
  }),
  destinationLocation: normalizeText(event.location),
  destinationStartTime: event.startTime,
  destinationSummary: normalizeText(event.summary),
  endTime: event.endTime,
  eventStateId: event.id,
  id: "mapping-1",
  missingFirstObservedAt: null,
  missingObservationCount: 0,
  recurrenceId: null,
  recurrenceRule: null,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: event.startTime,
  syncEventHash: createSyncEventContentHash(event),
  syncEventId: event.id,
} as EventMapping);

const createScope = (): ReconciliationScope => ({
  authoritativeWindow: TEST_WINDOW,
  requestedWindow: TEST_WINDOW,
  writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, {
    deleteApproved: false,
    destinationCalendarId: DESTINATION_CALENDAR_ID,
    excludeEventDescription: false,
    excludeEventLocation: false,
    excludeEventName: false,
    paused: false,
    sourceCalendarId: SOURCE_CALENDAR_ID,
    writeBackMode: "edits_and_deletes",
  }]]),
} as ReconciliationScope);

const classify = (listing: { items: RemoteEvent[]; rawItemCount: number }) => {
  const event = createLocalEvent();
  return classifyInboundChanges({
    existingMappings: [createMapping(event)],
    localEvents: [event],
    now: NOW,
    remoteEvents: listing.items,
    remoteRawItemCount: listing.rawItemCount,
    scope: createScope(),
  });
};

/*
 * One event on the destination calendar, and it is the user's own — no Keeper.sh category,
 * a uid that is not one of ours. Every copy is gone from this listing.
 */
const FOREIGN_GRAPH_EVENT = {
  end: { dateTime: "2027-05-11T16:00:00.0000000", timeZone: "UTC" },
  iCalUId: "the-users-own-event-uid",
  id: "the-users-own-event-id",
  isAllDay: false,
  start: { dateTime: "2027-05-11T15:00:00.0000000", timeZone: "UTC" },
  subject: "Dentist",
};

const FOREIGN_GOOGLE_EVENT = {
  end: { dateTime: "2027-05-11T16:00:00.000Z" },
  iCalUID: "the-users-own-event-uid",
  id: "the-users-own-event-id",
  start: { dateTime: "2027-05-11T15:00:00.000Z" },
  status: "confirmed",
  summary: "Dentist",
};

describe("a destination listing that carried the user's own events but no copies", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is not a healthy read on Google", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ items: [FOREIGN_GOOGLE_EVENT] })),
    );
    const provider = createGoogleSyncProvider({
      accessToken: "test-token",
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      calendarId: DESTINATION_CALENDAR_ID,
      externalCalendarId: "external-cal-1",
      refreshToken: "test-refresh",
      userId: "user-1",
    });

    const listing = await provider.listRemoteEvents({ timeMax: new Date("2099-01-01T00:00:00.000Z"), timeMin: TEST_WINDOW.timeMin });
    const result = classify(listing);

    expect(result.readHealth).toBe("live_empty");
    expect(result.healthyReadSourceCalendarIds).toEqual([]);
  });

  it("is not a healthy read on Outlook either", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ value: [FOREIGN_GRAPH_EVENT] })),
    );
    const provider = createOutlookSyncProvider({
      accessToken: "test-token",
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      calendarId: DESTINATION_CALENDAR_ID,
      externalCalendarId: "external-cal-1",
      refreshToken: "test-refresh",
      userId: "user-1",
    });

    const listing = await provider.listRemoteEvents({ timeMax: new Date("2099-01-01T00:00:00.000Z"), timeMin: TEST_WINDOW.timeMin });
    const result = classify(listing);

    expect(result.readHealth).toBe("live_empty");
    expect(result.healthyReadSourceCalendarIds).toEqual([]);
  });
});
