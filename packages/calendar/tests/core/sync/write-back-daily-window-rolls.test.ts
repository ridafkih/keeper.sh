import { describe, expect, it } from "vitest";
import {
  TWO_WAY_WRITE_BACK_DAILY_CAP,
  TWO_WAY_WRITE_BACK_DAILY_WINDOW_MS,
} from "@keeper.sh/constants";
import { classifyInboundChanges } from "../../../src/core/sync/write-back";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
  normalizeText,
} from "../../../src/core/events/content-hash";
import { resolveIsAllDayEvent } from "../../../src/core/events/all-day";
import type { MaterializedSyncableEvent, RemoteEvent } from "../../../src/core/types";

const SOURCE_CALENDAR_ID = "source-calendar-id";
const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const MOVED_START_TIME = new Date("2027-05-11T17:00:00.000Z");
const MOVED_END_TIME = new Date("2027-05-11T18:00:00.000Z");
const NOW = new Date("2027-05-01T12:00:00.000Z");
const HOUR_MS = 3_600_000;

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
  eventStateId: "event-state-id-1",
  id: "event-state-id-1",
  location: "Room 4",
  sourceEventUid: "source-event-uid-1",
  startTime: START_TIME,
  summary: "Quarterly review",
});

const createMapping = (
  event: MaterializedSyncableEvent,
  daily: { count: number; windowStart: Date },
) => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: "destination-delete-id-1",
  destinationAvailability: "busy" as const,
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
  eventStateId: event.eventStateId ?? event.id,
  id: "mapping-id-1",
  missingFirstObservedAt: null,
  missingObservationCount: 0,
  recurrenceId: null,
  recurrenceRule: null,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: event.startTime,
  syncEventHash: createSyncEventContentHash(event),
  syncEventId: event.id,
  writeBackDailyCount: daily.count,
  writeBackDailyWindowStart: daily.windowStart,
  writeBackEpoch: 0,
  writeBackEpochWindowStart: null,
});

const createMovedRemoteEvent = (
  mapping: ReturnType<typeof createMapping>,
): RemoteEvent => ({
  deleteId: mapping.deleteIdentifier,
  editableAvailability: "busy",
  editableContentHash: createEditableEventContentHash(createLocalEvent()),
  editableFields: {
    description: "Bring the notes",
    isAllDay: false,
    location: "Room 4",
    summary: "Quarterly review",
  },
  endTime: MOVED_END_TIME,
  isKeeperEvent: true,
  startTime: MOVED_START_TIME,
  supportedAvailabilities: ["busy", "free"],
  uid: mapping.destinationEventUid,
});

const classify = (daily: { count: number; windowStart: Date }) => {
  const event = createLocalEvent();
  const mapping = createMapping(event, daily);
  return classifyInboundChanges({
    existingMappings: [mapping],
    localEvents: [event],
    now: NOW,
    remoteEvents: [createMovedRemoteEvent(mapping)],
    remoteRawItemCount: 1,
    scope: {
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
        writeBackMode: "edits" as const,
      }]]),
    },
  }).classifications;
};

describe("two-way sync: the daily write-back window rolls", () => {
  it("hands a spent mapping a fresh budget once the window has elapsed", () => {
    const classifications = classify({
      count: TWO_WAY_WRITE_BACK_DAILY_CAP,
      windowStart: new Date(NOW.getTime() - TWO_WAY_WRITE_BACK_DAILY_WINDOW_MS - HOUR_MS),
    });

    expect(classifications.map(({ type }) => type)).toEqual(["write-back"]);
  });

  it("still refuses a mapping that spent its budget inside the live window", () => {
    const classifications = classify({
      count: TWO_WAY_WRITE_BACK_DAILY_CAP,
      windowStart: new Date(NOW.getTime() - HOUR_MS),
    });

    expect(classifications).toMatchObject([
      { reason: "write_back_quarantined", type: "rejected" },
    ]);
  });
});
