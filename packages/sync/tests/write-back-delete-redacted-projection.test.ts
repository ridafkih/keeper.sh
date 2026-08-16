import { describe, expect, it } from "vitest";
import {
  classifyInboundChanges,
  createEditableEventContentHash,
  createSyncEventContentHash,
  normalizeText,
} from "@keeper.sh/calendar";
import type {
  CalendarSourceWriter,
  InboundClassification,
  MaterializedSyncableEvent,
  RemoteEvent,
} from "@keeper.sh/calendar";
import { runWriteBackPass } from "../src/write-back-pass";
import type {
  LockedWriteBackStore,
  SourceEventSnapshot,
  WriteBackStore,
  WriteBackTarget,
} from "../src/write-back-pass";

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

const RAW_TITLE = "Quarterly review";
const RAW_DESCRIPTION = "Bring the notes";
const RAW_LOCATION = "Room 4";

interface Privacy {
  excludeEventDescription: boolean;
  excludeEventLocation: boolean;
  excludeEventName: boolean;
}

const projectSummary = (privacy: Privacy): string => {
  if (privacy.excludeEventName) {
    return "Personal";
  }
  return RAW_TITLE;
};

const readExpectedHash = (
  classifications: InboundClassification[],
): string | null => {
  const [first] = classifications;
  if (first?.type !== "delete") {
    return null;
  }
  return first.expectedSyncEventHash;
};

/*
 * What readLocalEventsForDestination produces: the pushed projection on summary,
 * description and location, and the source's own row beside it.
 */
const createLocalEvent = (
  id: string,
  privacy: Privacy,
): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Personal",
  calendarUrl: null,
  endTime: END_TIME,
  eventStateId: id,
  id,
  sourceEventUid: `source-event-uid-${id}`,
  sourceFields: {
    description: RAW_DESCRIPTION,
    location: RAW_LOCATION,
    title: RAW_TITLE,
  },
  startTime: START_TIME,
  summary: projectSummary(privacy),
  ...(!privacy.excludeEventDescription && { description: RAW_DESCRIPTION }),
  ...(!privacy.excludeEventLocation && { location: RAW_LOCATION }),
});

const createMapping = (event: MaterializedSyncableEvent, missing: boolean) => ({
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

const classifyOneVanishedCopy = (privacy: Privacy): InboundClassification[] => {
  const vanished = createLocalEvent("vanished", privacy);
  const localEvents = [vanished];
  const existingMappings = [createMapping(vanished, true)];
  const remoteEvents: RemoteEvent[] = [];

  for (let index = 0; index < HEALTHY_COPIES; index += 1) {
    const event = createLocalEvent(`healthy-${index}`, privacy);
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
        ...privacy,
        paused: false,
        sourceCalendarId: SOURCE_CALENDAR_ID,
        writeBackMode: "edits_and_deletes" as const,
      }]]),
    },
  }).classifications.filter((classification) => classification.type === "delete");
};

/* The event_states row the applier reads under the source lock. */
const createSourceSnapshot = (): SourceEventSnapshot => ({
  description: RAW_DESCRIPTION,
  endTime: END_TIME,
  isAllDay: null,
  location: RAW_LOCATION,
  startTime: START_TIME,
  startTimeZone: null,
  title: RAW_TITLE,
});

const applyDeletions = (classifications: InboundClassification[]) => {
  const log: string[] = [];
  const snapshot = createSourceSnapshot();

  const writer: CalendarSourceWriter = {
    deleteEvent: () => {
      log.push("provider:delete");
      return Promise.resolve({ success: true });
    },
    updateEvent: () => Promise.resolve({ success: true }),
  };

  const locked: LockedWriteBackStore = {
    commitDelete: () => {
      log.push("commit:delete");
      return Promise.resolve();
    },
    commitUpdate: () => Promise.resolve({ writeBackEpoch: 1 }),
    readMappingSyncEventHash: () =>
      Promise.resolve({ syncEventHash: readExpectedHash(classifications) }),
    readPairWriteBack: () =>
      Promise.resolve({ writeBackMode: "edits_and_deletes", writeBackState: "ok" }),
    readSourceEvent: () => Promise.resolve(snapshot),
  };

  const target: WriteBackTarget = {
    deleteIdentifier: "destination-delete-id-vanished",
    destinationCalendarId: DESTINATION_CALENDAR_ID,
    destinationEventUid: "destination-uid-vanished",
    eventStateId: "vanished",
    mappingId: "mapping-vanished",
    sourceCalendarId: SOURCE_CALENDAR_ID,
    sourceEventId: null,
    sourceEventUid: "source-event-uid-vanished",
  };

  const store: WriteBackStore = {
    abandonTombstone: () => Promise.resolve(),
    countRecentDeletes: () => Promise.resolve(0),
    loadTarget: () => Promise.resolve(target),
    notifySiblings: () => Promise.resolve(),
    probeDestinationEvent: () => Promise.resolve("absent"),
    quarantineMapping: () => Promise.resolve(),
    readSourceEvent: () => Promise.resolve(snapshot),
    recordFailure: () => Promise.resolve(5),
    recordTombstone: () => Promise.resolve({ id: "tombstone-1", observedAt: new Date(), priorAttempt: false }),
    requestDeleteConfirmation: (_source, _destination, reason) => {
      log.push(`pause:${reason}`);
      return Promise.resolve();
    },
    resolveWriter: () => Promise.resolve(writer),
    withSourceLock: (_sourceCalendarId, run) => run(locked),
  };

  return runWriteBackPass({
    calendarId: DESTINATION_CALENDAR_ID,
    classifications,
    store,
  }).then((result) => ({ log, result }));
};

const HIDES_NOTHING: Privacy = {
  excludeEventDescription: false,
  excludeEventLocation: false,
  excludeEventName: false,
};

const HIDES_EVERYTHING: Privacy = {
  excludeEventDescription: true,
  excludeEventLocation: true,
  excludeEventName: true,
};

describe("two-way sync: a deletion is judged against the source, not the projection", () => {
  it("names the source event's own title when the copies say only the calendar name", () => {
    const [deletion] = classifyOneVanishedCopy(HIDES_EVERYTHING);

    expect(deletion).toMatchObject({
      expectedSource: {
        description: RAW_DESCRIPTION,
        location: RAW_LOCATION,
        summary: RAW_TITLE,
      },
    });
  });

  it("deletes the original on a calendar that hides nothing", async () => {
    const { log, result } = await applyDeletions(classifyOneVanishedCopy(HIDES_NOTHING));

    expect(log).toEqual(["provider:delete", "commit:delete"]);
    expect(result).toMatchObject({ applied: 1 });
  });

  it("deletes the original on a calendar that hides every field", async () => {
    const { log, result } = await applyDeletions(classifyOneVanishedCopy(HIDES_EVERYTHING));

    expect(log).toEqual(["provider:delete", "commit:delete"]);
    expect(result).toMatchObject({ applied: 1 });
  });

  it("deletes the original on a calendar that hides only the description", async () => {
    const { log } = await applyDeletions(classifyOneVanishedCopy({
      excludeEventDescription: true,
      excludeEventLocation: false,
      excludeEventName: false,
    }));

    expect(log).toEqual(["provider:delete", "commit:delete"]);
  });

  it("never pauses the pair on a probe that answered absent", async () => {
    const { log } = await applyDeletions(classifyOneVanishedCopy(HIDES_EVERYTHING));

    expect(log).not.toContain("pause:delete_probe_blocked");
  });

  it("still refuses when the hidden description moved after the classification", async () => {
    const classifications = classifyOneVanishedCopy(HIDES_EVERYTHING);
    const log: string[] = [];
    const moved: SourceEventSnapshot = {
      ...createSourceSnapshot(),
      description: "Do not delete, rescheduling in progress",
    };

    const writer: CalendarSourceWriter = {
      deleteEvent: () => {
        log.push("provider:delete");
        return Promise.resolve({ success: true });
      },
      updateEvent: () => Promise.resolve({ success: true }),
    };
    const store: WriteBackStore = {
      abandonTombstone: () => Promise.resolve(),
      countRecentDeletes: () => Promise.resolve(0),
      loadTarget: () => Promise.resolve({
        deleteIdentifier: "destination-delete-id-vanished",
        destinationCalendarId: DESTINATION_CALENDAR_ID,
        destinationEventUid: "destination-uid-vanished",
        eventStateId: "vanished",
        mappingId: "mapping-vanished",
        sourceCalendarId: SOURCE_CALENDAR_ID,
        sourceEventId: null,
        sourceEventUid: "source-event-uid-vanished",
      }),
      notifySiblings: () => Promise.resolve(),
      probeDestinationEvent: () => Promise.resolve("absent"),
      quarantineMapping: () => Promise.resolve(),
      readSourceEvent: () => Promise.resolve(moved),
      recordFailure: () => Promise.resolve(1),
      recordTombstone: () => Promise.resolve({ id: "tombstone-1", observedAt: new Date(), priorAttempt: false }),
      resolveWriter: () => Promise.resolve(writer),
      withSourceLock: (_sourceCalendarId, run) => run({
        commitDelete: () => Promise.resolve(),
        commitUpdate: () => Promise.resolve({ writeBackEpoch: 1 }),
        readMappingSyncEventHash: () =>
          Promise.resolve({ syncEventHash: readExpectedHash(classifications) }),
        readPairWriteBack: () =>
          Promise.resolve({ writeBackMode: "edits_and_deletes", writeBackState: "ok" }),
        readSourceEvent: () => Promise.resolve(moved),
      }),
    };

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications,
      store,
    });

    expect(log).toEqual([]);
    expect(result).toMatchObject({ applied: 0 });
  });
});
