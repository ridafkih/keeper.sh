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
const ELEVEN_MINUTES_MS = 11 * 60_000;
const NO_ITEMS = 0;
const FIRST_OBSERVATION = 1;

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

const resolveMissingObservation = (
  missing: boolean,
): { missingFirstObservedAt: Date | null; missingObservationCount: number } => {
  if (missing) {
    return {
      missingFirstObservedAt: new Date(NOW.getTime() - ELEVEN_MINUTES_MS),
      missingObservationCount: FIRST_OBSERVATION,
    };
  }
  return { missingFirstObservedAt: null, missingObservationCount: NO_ITEMS };
};

const createMapping = (
  event: MaterializedSyncableEvent,
  missing: boolean,
): EventMapping =>
  ({
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
    ...resolveMissingObservation(missing),
    recurrenceId: null,
    recurrenceRule: null,
    sourceCalendarId: SOURCE_CALENDAR_ID,
    startTime: event.startTime,
    syncEventHash: createSyncEventContentHash(event),
    syncEventId: event.id,
  }) as unknown as EventMapping;

const createRemoteEvent = (
  mapping: EventMapping,
  event: MaterializedSyncableEvent,
): RemoteEvent => ({
  deleteId: mapping.deleteIdentifier,
  editableAvailability: "busy",
  editableContentHash: createEditableEventContentHash(event),
  editableFields: {
    description: event.description ?? "",
    isAllDay: false,
    location: event.location ?? "",
    summary: event.summary,
  },
  endTime: mapping.endTime,
  isKeeperEvent: true,
  startTime: mapping.startTime,
  supportedAvailabilities: ["busy", "free"],
  uid: mapping.destinationEventUid,
});

const resolveRemoteEvents = (
  copyPresent: boolean,
  mapping: EventMapping,
  event: MaterializedSyncableEvent,
): RemoteEvent[] => {
  if (copyPresent) {
    return [createRemoteEvent(mapping, event)];
  }
  return [];
};

const runPass = async (input: { copyPresent: boolean }): Promise<{
  confirmations: string[];
  healthyReads: string[][];
}> => {
  const event = createLocalEvent();
  const mapping = createMapping(event, !input.copyPresent);
  const remoteEvents = resolveRemoteEvents(input.copyPresent, mapping, event);
  const confirmations: string[] = [];
  const healthyReads: string[][] = [];

  const provider = {
    deleteEvents: (ids: string[]) => Promise.resolve(ids.map(() => ({ success: true }))),
    listRemoteEvents: () => Promise.resolve(remoteEvents),
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
    isCurrent: () => Promise.resolve(true),
    now: () => NOW,
    provider,
    readState: () =>
      Promise.resolve({
        existingMappings: [mapping],
        localEvents: [event],
        remoteEvents,
        remoteRawItemCount: remoteEvents.length,
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
    recordHealthyRead: (sourceCalendarIds: string[]) => {
      healthyReads.push(sourceCalendarIds);
      return Promise.resolve();
    },
    requestDeleteConfirmation: (request: { reason: string }) => {
      confirmations.push(request.reason);
      return Promise.resolve();
    },
    userId: USER_ID,
  } as never);

  return { confirmations, healthyReads };
};

/*
 * The two observations the blank-read gate is decided on, taken through the engine that
 * hands them out. A read that came back with nothing at all asks the question and clears
 * nothing; the next read that comes back with a copy is what releases the answer, and it
 * is only reported when there was something to read.
 */
describe("what a pass hands out about a destination it could not read", () => {
  it("asks about the copies and reports no read it could trust", async () => {
    const { confirmations, healthyReads } = await runPass({ copyPresent: false });

    expect(confirmations).toEqual(["all_copies_missing"]);
    expect(healthyReads).toHaveLength(NO_ITEMS);
  });

  it("reports the read that came back with a copy, and asks nothing", async () => {
    const { confirmations, healthyReads } = await runPass({ copyPresent: true });

    expect(confirmations).toEqual([]);
    expect(healthyReads).toEqual([[SOURCE_CALENDAR_ID]]);
  });
});
