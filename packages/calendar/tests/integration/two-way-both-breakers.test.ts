import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../src/index";
import type {
  EventMapping,
  MaterializedSyncableEvent,
  PendingChanges,
  RemoteEvent,
} from "../../src/index";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
  normalizeText,
} from "../../src/core/events/content-hash";
import { resolveIsAllDayEvent } from "../../src/core/events/all-day";

const SOURCE_CALENDAR_ID = "source-calendar";
const DESTINATION_CALENDAR_ID = "destination-calendar";
const USER_ID = "user-1";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const NOW = new Date("2027-05-01T12:00:00.000Z");
const ELEVEN_MINUTES_AGO = new Date(NOW.getTime() - 11 * 60_000);
const HOUR_MS = 3_600_000;

const VANISHED_COUNT = 20;
const EDITED_COUNT = 15;
const QUIET_COUNT = 5;

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
  startTime: START_TIME,
  summary: "Quarterly review",
});

const createMapping = (
  event: MaterializedSyncableEvent,
  missing: boolean,
): EventMapping =>
  ({
    calendarId: DESTINATION_CALENDAR_ID,
    deleteIdentifier: `destination-delete-id-${event.id}`,
    destinationAvailability: "busy",
    destinationContentHash: createEditableEventContentHash(event),
    destinationDescription: normalizeText(event.description),
    destinationEndTime: event.endTime,
    destinationEventUid: `destination-uid-${event.id}`,
    destinationIsAllDay: resolveIsAllDayEvent({
      endTime: event.endTime,
      startTime: event.startTime,
    }),
    destinationLocation: normalizeText(event.location),
    destinationStartTime: event.startTime,
    destinationSummary: normalizeText(event.summary),
    endTime: event.endTime,
    eventStateId: event.eventStateId ?? event.id,
    id: `mapping-${event.id}`,
    missingFirstObservedAt: null,
    missingObservationCount: 0,
    ...(missing && {
      missingFirstObservedAt: ELEVEN_MINUTES_AGO,
      missingObservationCount: 1,
    }),
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
  }) as unknown as EventMapping;

const createRemoteEvent = (
  mapping: EventMapping,
  event: MaterializedSyncableEvent,
  shifted: boolean,
): RemoteEvent =>
  ({
    deleteId: mapping.deleteIdentifier,
    editableAvailability: "busy",
    editableContentHash: createEditableEventContentHash(event),
    editableFields: {
      description: event.description,
      isAllDay: false,
      location: event.location,
      summary: event.summary,
    },
    endTime: END_TIME,
    isKeeperEvent: true,
    startTime: START_TIME,
    supportedAvailabilities: ["busy", "free"],
    ...(shifted && {
      endTime: new Date(END_TIME.getTime() + HOUR_MS),
      startTime: new Date(START_TIME.getTime() + HOUR_MS),
    }),
    uid: mapping.destinationEventUid,
  }) as unknown as RemoteEvent;

interface Fixture {
  localEvents: MaterializedSyncableEvent[];
  mappings: EventMapping[];
  remoteEvents: RemoteEvent[];
}

/*
 * One source calendar on one destination. Twenty copies are gone from the listing and have
 * already been seen missing once, eleven minutes ago — enough for the delete breaker.
 * Fifteen more are still there and have all moved by an hour — enough for the edit breaker.
 */
const buildFixture = (): Fixture => {
  const localEvents: MaterializedSyncableEvent[] = [];
  const mappings: EventMapping[] = [];
  const remoteEvents: RemoteEvent[] = [];

  for (let index = 0; index < VANISHED_COUNT; index += 1) {
    const event = createLocalEvent(`vanished-${index}`);
    localEvents.push(event);
    mappings.push(createMapping(event, true));
  }
  for (let index = 0; index < EDITED_COUNT; index += 1) {
    const event = createLocalEvent(`edited-${index}`);
    const mapping = createMapping(event, false);
    localEvents.push(event);
    mappings.push(mapping);
    remoteEvents.push(createRemoteEvent(mapping, event, true));
  }
  for (let index = 0; index < QUIET_COUNT; index += 1) {
    const event = createLocalEvent(`quiet-${index}`);
    const mapping = createMapping(event, false);
    localEvents.push(event);
    mappings.push(mapping);
    remoteEvents.push(createRemoteEvent(mapping, event, false));
  }

  return { localEvents, mappings, remoteEvents };
};

/*
 * Both recorders in production write the same source_destination_mappings row with an
 * unconditional UPDATE, so the cell they share is the pair's write-back state.
 */
const runPass = async (): Promise<{
  reasons: string[];
  writeBackState: string;
}> => {
  const fixture = buildFixture();
  const reasons: string[] = [];
  let writeBackState = "ok";

  const provider = {
    deleteEvents: (ids: string[]) => Promise.resolve(ids.map(() => ({ success: true }))),
    listRemoteEvents: () => Promise.resolve(fixture.remoteEvents),
    pushEvents: (events: MaterializedSyncableEvent[]) =>
      Promise.resolve(events.map((_event, index) => ({
        deleteId: `pushed-${index}`,
        remoteId: `pushed-${index}`,
        success: true,
      }))),
  };

  await syncCalendar({
    calendarId: DESTINATION_CALENDAR_ID,
    flush: (_changes: PendingChanges) => Promise.resolve(),
    holdWriteBack: (request: { reason: string }) => {
      writeBackState = "quarantined";
      reasons.push(`hold:${request.reason}`);
      return Promise.resolve();
    },
    isCurrent: () => Promise.resolve(true),
    now: () => NOW,
    provider,
    readState: () =>
      Promise.resolve({
        existingMappings: fixture.mappings,
        localEvents: fixture.localEvents,
        remoteEvents: fixture.remoteEvents,
        remoteRawItemCount: fixture.remoteEvents.length,
      }),
    reconciliationScope: {
      authoritativeWindow: TEST_WINDOW,
      requestedWindow: TEST_WINDOW,
      writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, {
        deleteApproved: false,
        deleteApprovedAt: null,
        destinationCalendarId: DESTINATION_CALENDAR_ID,
        excludeEventDescription: false,
        excludeEventLocation: false,
        excludeEventName: false,
        paused: false,
        sourceCalendarId: SOURCE_CALENDAR_ID,
        writeBackMode: "edits_and_deletes",
      }]]),
    },
    requestDeleteConfirmation: (request: { reason: string }) => {
      writeBackState = "delete_confirmation_required";
      reasons.push(`confirm:${request.reason}`);
      return Promise.resolve();
    },
    userId: USER_ID,
  } as never);

  return { reasons, writeBackState };
};

describe("a pass that trips both breakers at once", () => {
  it("still asks the user about the copies that vanished", async () => {
    const { reasons, writeBackState } = await runPass();

    expect(reasons).toContain("confirm:delete_breaker_tripped");
    expect(reasons).toContain("hold:bulk_edit_breaker");
    expect(writeBackState).toBe("delete_confirmation_required");
  });
});
