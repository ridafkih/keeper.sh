import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyInboundChanges } from "../../../../src/core/sync/write-back";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
  normalizeText,
} from "../../../../src/core/events/content-hash";
import { resolveIsAllDayEvent } from "../../../../src/core/events/all-day";
import type { EventMapping } from "../../../../src/core/events/mappings";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import type { ReconciliationScope } from "../../../../src/core/sync/operations";
import { createCalDAVSyncProvider } from "../../../../src/providers/caldav/destination/provider";

const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const SOURCE_CALENDAR_ID = "source-calendar-id";
const CALENDAR_URL = "https://caldav.example.com/calendar/";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const NOW = new Date("2027-05-01T12:00:00.000Z");
const NO_OBJECTS = 0;
const OWN_OBJECT_COUNT = 3;

const TEST_WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

const clientMocks = vi.hoisted(() => ({
  createCalendarObject: vi.fn(),
  deleteCalendarObject: vi.fn(),
  deleteCalendarObjectByUrl: vi.fn(),
  fetchCalendarObject: vi.fn(),
  fetchCalendarObjects: vi.fn(),
  resolveCalendarUrl: vi.fn(),
}));

vi.mock("../../../../src/providers/caldav/shared/client", () => {
  class CalDAVHttpError extends Error {
    status = 0;
  }

  class CalDAVClient {
    createCalendarObject = clientMocks.createCalendarObject;
    deleteCalendarObject = clientMocks.deleteCalendarObject;
    deleteCalendarObjectByUrl = clientMocks.deleteCalendarObjectByUrl;
    fetchCalendarObject = clientMocks.fetchCalendarObject;
    fetchCalendarObjects = clientMocks.fetchCalendarObjects;
    resolveCalendarUrl = clientMocks.resolveCalendarUrl;
  }

  return {
    CalDAVClient,
    CalDAVCreateConflictError: class extends CalDAVHttpError {},
    CalDAVHttpError,
  };
});

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
  deleteIdentifier: "/calendar/keeper-copy.ics",
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
  missingObservationCount: NO_OBJECTS,
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

const createProvider = () =>
  createCalDAVSyncProvider({
    calendarUrl: CALENDAR_URL,
    password: "pass",
    serverUrl: "https://caldav.example.com",
    username: "user",
  });

/*
 * The server listed the user's own objects and nothing of ours. Every Keeper path was
 * filtered out before the multiget, so the objects the provider ends up holding are none —
 * but the read itself plainly reached a live calendar carrying events.
 */
const answerWithOnlyTheUsersOwnObjects = () => {
  clientMocks.resolveCalendarUrl.mockResolvedValue(CALENDAR_URL);
  clientMocks.fetchCalendarObjects.mockImplementation((params: {
    onListing?: (stats: {
      listedCount: number;
      requestedCount: number;
      returnedCount: number;
      unrequestedCount: number;
    }) => void;
  }) => {
    params.onListing?.({
      listedCount: OWN_OBJECT_COUNT,
      requestedCount: NO_OBJECTS,
      returnedCount: NO_OBJECTS,
      unrequestedCount: NO_OBJECTS,
    });
    return Promise.resolve([]);
  });
};

describe("a CalDAV destination listing that carried the user's own objects but no copies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /*
   * The count that reaches the classifier has to be what the server listed, not what
   * survived the Keeper path filter. Counting after the filter makes a live calendar full
   * of the user's own events indistinguishable from a server that answered nothing, and the
   * second of those holds the deletion back to ask the user a question they should never
   * have been asked.
   */
  it("reports the read as live rather than as an answer nobody can trust", async () => {
    answerWithOnlyTheUsersOwnObjects();
    const event = createLocalEvent();

    const listing = await createProvider().listRemoteEvents({
      timeMax: new Date("2099-01-01T00:00:00.000Z"),
      timeMin: TEST_WINDOW.timeMin,
    });
    const result = classifyInboundChanges({
      existingMappings: [createMapping(event)],
      localEvents: [event],
      now: NOW,
      remoteEvents: listing.items,
      remoteRawItemCount: listing.rawItemCount,
      scope: createScope(),
    });

    expect(listing.rawItemCount).toBe(OWN_OBJECT_COUNT);
    expect(result.readHealth).toBe("live_empty");
    expect(result.deleteConfirmation).toBeNull();
  });
});
