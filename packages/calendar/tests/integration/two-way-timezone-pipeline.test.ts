import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyInboundChanges } from "../../src/core/sync/write-back";
import type { InboundClassification } from "../../src/core/sync/write-back";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
  normalizeText,
} from "../../src/core/events/content-hash";
import type { EventMapping } from "../../src/core/events/mappings";
import type { MaterializedSyncableEvent, RemoteEvent } from "../../src/core/types";
import { createGoogleSourceWriter } from "../../src/providers/google/source/mutations";
import { createOutlookSourceWriter } from "../../src/providers/outlook/source/mutations";
import { wallTimeToInstant } from "../../src/ics/utils/timezone-instant";

const SOURCE_CALENDAR_ID = "source-calendar-id";
const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const SOURCE_TIME_ZONE = "America/Toronto";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const MOVED_START_TIME = new Date("2027-05-11T17:00:00.000Z");
const MOVED_END_TIME = new Date("2027-05-11T18:00:00.000Z");
const MOVED_START_LOCAL = "2027-05-11T13:00:00.000";
const MOVED_END_LOCAL = "2027-05-11T14:00:00.000";
const NOW = new Date("2027-05-01T12:00:00.000Z");

const TEST_WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

const LOCAL_EVENT: MaterializedSyncableEvent = {
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
  startTimeZone: SOURCE_TIME_ZONE,
  summary: "Quarterly review",
};

const MAPPING = {
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: "destination-delete-id-1",
  destinationAvailability: "busy",
  destinationContentHash: createEditableEventContentHash(LOCAL_EVENT),
  destinationDescription: normalizeText(LOCAL_EVENT.description),
  destinationEndTime: END_TIME,
  destinationEventUid: "destination-uid-1",
  destinationIsAllDay: false,
  destinationLocation: normalizeText(LOCAL_EVENT.location),
  destinationStartTime: START_TIME,
  destinationSummary: normalizeText(LOCAL_EVENT.summary),
  endTime: END_TIME,
  eventStateId: "event-state-id-1",
  id: "mapping-id-1",
  missingFirstObservedAt: null,
  missingObservationCount: 0,
  recurrenceId: null,
  recurrenceRule: null,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: START_TIME,
  syncEventHash: createSyncEventContentHash(LOCAL_EVENT),
  syncEventId: "event-state-id-1",
  writeBackEpoch: 0,
  writeBackEpochWindowStart: null,
} as unknown as EventMapping;

const MOVED_MIRROR: RemoteEvent = {
  deleteId: "destination-delete-id-1",
  editableAvailability: "busy",
  editableContentHash: createEditableEventContentHash(LOCAL_EVENT),
  editableFields: {
    description: LOCAL_EVENT.description ?? "",
    isAllDay: false,
    location: LOCAL_EVENT.location ?? "",
    summary: LOCAL_EVENT.summary,
  },
  endTime: MOVED_END_TIME,
  isKeeperEvent: true,
  startTime: MOVED_START_TIME,
  supportedAvailabilities: ["busy", "free"],
  uid: "destination-uid-1",
};

const classifyMovedMirror = (): Extract<InboundClassification, { type: "write-back" }> => {
  const { classifications } = classifyInboundChanges({
    existingMappings: [MAPPING],
    localEvents: [LOCAL_EVENT],
    now: NOW,
    remoteEvents: [MOVED_MIRROR],
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
  });

  const [classification] = classifications;
  if (classification?.type !== "write-back") {
    throw new Error(`Expected a write-back, got ${classification?.type ?? "nothing"}`);
  }
  return classification;
};

describe("a moved copy travels from the classifier to the source with the source's zone", () => {
  const originalFetch = globalThis.fetch;
  let bodies: Record<string, unknown>[] = [];

  beforeEach(() => {
    bodies = [];
    globalThis.fetch = vi.fn((_input: unknown, init?: RequestInit) => {
      if (typeof init?.body === "string") {
        bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("patches Google with the zone the source holds, never a bare instant", async () => {
    const classification = classifyMovedMirror();
    const writer = createGoogleSourceWriter({
      accessToken: () => Promise.resolve("token"),
      externalCalendarId: "primary",
    });

    await writer.updateEvent(
      { sourceEventId: "google-event-id", sourceEventUid: LOCAL_EVENT.sourceEventUid },
      classification.updates,
    );

    expect(bodies[0]).toMatchObject({
      end: { dateTime: MOVED_END_TIME.toISOString(), timeZone: SOURCE_TIME_ZONE },
      start: { dateTime: MOVED_START_TIME.toISOString(), timeZone: SOURCE_TIME_ZONE },
    });
  });

  it("patches Outlook with the zone the source holds, never a re-homed UTC event", async () => {
    const classification = classifyMovedMirror();
    const writer = createOutlookSourceWriter({
      accessToken: () => Promise.resolve("token"),
    });

    await writer.updateEvent(
      { sourceEventId: "outlook-event-id", sourceEventUid: LOCAL_EVENT.sourceEventUid },
      classification.updates,
    );

    expect(bodies[0]).toMatchObject({
      end: { dateTime: MOVED_END_LOCAL, timeZone: SOURCE_TIME_ZONE },
      start: { dateTime: MOVED_START_LOCAL, timeZone: SOURCE_TIME_ZONE },
    });
  });

  it("moves the Outlook original to the same instants the copy was moved to", async () => {
    const classification = classifyMovedMirror();
    const writer = createOutlookSourceWriter({
      accessToken: () => Promise.resolve("token"),
    });

    await writer.updateEvent(
      { sourceEventId: "outlook-event-id", sourceEventUid: LOCAL_EVENT.sourceEventUid },
      classification.updates,
    );

    const schedule = bodies[0] as {
      end: { dateTime: string; timeZone: string };
      start: { dateTime: string; timeZone: string };
    };
    expect(wallTimeToInstant(new Date(`${schedule.start.dateTime}Z`), schedule.start.timeZone))
      .toEqual(MOVED_START_TIME);
    expect(wallTimeToInstant(new Date(`${schedule.end.dateTime}Z`), schedule.end.timeZone))
      .toEqual(MOVED_END_TIME);
  });
});
