import { describe, expect, it } from "vitest";
import { classifyInboundChanges } from "../../../src/core/sync/write-back";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
  normalizeText,
} from "../../../src/core/events/content-hash";
import type { MaterializedSyncableEvent, RemoteEvent } from "../../../src/core/types";

const SOURCE_CALENDAR_ID = "source-calendar-id";
const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const NOW = new Date("2027-05-01T12:00:00.000Z");
const MINUTE_MS = 60_000;
const GRACE_MS = 10 * MINUTE_MS;
const LONG_GONE = new Date(NOW.getTime() - GRACE_MS - MINUTE_MS);
const OBSERVATIONS = 2;
const HEALTHY_COPIES = 40;

const TEST_WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

const createLocalEvent = (id: string): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Personal",
  calendarUrl: null,
  description: "Bring the notes",
  endTime: END_TIME,
  eventStateId: id,
  id,
  location: "Room 4",
  sourceEventUid: `source-event-uid-${id}`,
  sourceFields: {
    description: "Bring the notes",
    location: "Room 4",
    title: "Quarterly review",
  },
  startTime: START_TIME,
  summary: "Quarterly review",
});

const createMapping = (
  event: MaterializedSyncableEvent,
  missing: boolean,
) => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: `destination-delete-id-${event.id}`,
  destinationAvailability: "busy" as const,
  destinationContentHash: createEditableEventContentHash(event),
  destinationDescription: normalizeText(event.description),
  destinationEndTime: event.endTime,
  destinationEventUid: `destination-uid-${event.id}`,
  destinationIsAllDay: false,
  destinationLocation: normalizeText(event.location),
  destinationStartTime: event.startTime,
  destinationSummary: normalizeText(event.summary),
  endTime: event.endTime,
  eventStateId: event.id,
  id: `mapping-${event.id}`,
  ...(missing && {
    missingFirstObservedAt: LONG_GONE,
    missingObservationCount: OBSERVATIONS,
  }),
  ...(!missing && { missingFirstObservedAt: null, missingObservationCount: 0 }),
  recurrenceId: null,
  recurrenceRule: null,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: event.startTime,
  syncEventHash: createSyncEventContentHash(event),
  syncEventId: event.id,
  writeBackDailyCount: 0,
  writeBackDailyWindowStart: null,
  writeBackEpoch: 0,
  writeBackEpochWindowStart: null,
});

const createRemoteEvent = (
  mapping: ReturnType<typeof createMapping>,
  event: MaterializedSyncableEvent,
): RemoteEvent => ({
  deleteId: mapping.deleteIdentifier,
  editableAvailability: "busy",
  editableContentHash: createEditableEventContentHash(event),
  editableFields: {
    description: event.description,
    isAllDay: false,
    location: event.location,
    summary: event.summary,
  },
  endTime: mapping.endTime,
  isKeeperEvent: true,
  startTime: mapping.startTime,
  supportedAvailabilities: ["busy", "free"],
  uid: mapping.destinationEventUid,
} as RemoteEvent);

const classifyOneVanishedCopy = () => {
  const vanished = createLocalEvent("vanished");
  const localEvents = [vanished];
  const existingMappings = [createMapping(vanished, true)];
  const remoteEvents: RemoteEvent[] = [];

  for (let index = 0; index < HEALTHY_COPIES; index += 1) {
    const event = createLocalEvent(`healthy-${index}`);
    const mapping = createMapping(event, false);
    localEvents.push(event);
    existingMappings.push(mapping);
    remoteEvents.push(createRemoteEvent(mapping, event));
  }

  return classifyInboundChanges({
    existingMappings,
    localEvents,
    now: NOW,
    remoteEvents,
    remoteRawItemCount: remoteEvents.length,
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
        writeBackMode: "edits_and_deletes" as const,
      }]]),
    },
  }).classifications;
};

describe("two-way sync: what a deletion says the source event looked like", () => {
  /*
   * The classifier refuses a deletion outright when any field of the source moved since the
   * last push. The pass re-establishes that under the lock against these fields alone, so a
   * deletion that reports only the schedule lets a title or a note edited in the gap go
   * unnoticed.
   */
  it("reports the source event's text as well as its schedule", () => {
    const deletion = classifyOneVanishedCopy()
      .find((classification) => classification.type === "delete");

    expect(deletion).toMatchObject({
      expectedSource: {
        description: "Bring the notes",
        endTime: END_TIME,
        isAllDay: false,
        location: "Room 4",
        startTime: START_TIME,
        summary: "Quarterly review",
      },
    });
  });
});
