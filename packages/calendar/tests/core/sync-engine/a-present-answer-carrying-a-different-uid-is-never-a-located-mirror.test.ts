import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type {
  DeleteResult,
  EventPresence,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
  SyncOperation,
} from "../../../src/core/types";
import type {
  CalendarSyncProvider,
  EventUpdate,
  PendingChanges,
} from "../../../src/core/sync-engine/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "cal-1";

const START_TIME = new Date("2026-09-01T15:00:00.000Z");
const END_TIME = new Date("2026-09-01T16:00:00.000Z");

/* Two different customer events. A's object is the one that physically lives at SHARED_PATH; B is
   the event this run is trying to deliver an edit for, and its mapping still names A's href because
   the href was recorded before the collection was re-keyed under it. */
const UID_A = "uid-a@keeper.sh";
const UID_B = "uid-b@keeper.sh";
const SHARED_PATH = "/calendar/uid-a.ics";
const MAPPING_B = "map-b";

const localEventB: MaterializedSyncableEvent = {
  calendarId: "source-cal-1",
  calendarName: "Work",
  calendarUrl: null,
  endTime: END_TIME,
  id: "ev-b",
  sourceEventUid: "source-uid-b",
  startTime: START_TIME,
  summary: "Retro, moved",
};

const mappedEventB: MaterializedSyncableEvent = { ...localEventB, summary: "Retro" };

const mappingB: EventMapping = {
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: SHARED_PATH,
  destinationEventUid: UID_B,
  endTime: END_TIME,
  eventStateId: "ev-b",
  id: MAPPING_B,
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: createSyncEventContentHash(mappedEventB),
  syncEventId: "ev-b",
};

/* The plan already read the destination this cycle and did not see B's mirror, which is what sends
   the mapping into the verification path rather than into a plain in-place update. */
const replacementB: SyncOperation = {
  deleteId: SHARED_PATH,
  event: localEventB,
  remoteMissing: true,
  staleMappingId: MAPPING_B,
  type: "replace",
  uid: UID_B,
};

/* Event A's object, answered at the href the read asked about. This is exactly the shape today's
   CalDAV presenceOfAnswer produces -- it hands back the FIRST VEVENT in the fetched object with no
   uid comparison -- and the shape Outlook's verifyTarget produces from a direct item-id GET, so the
   double is no kinder than either real provider. */
const eventAAtSharedPath: RemoteEvent = {
  deleteId: SHARED_PATH,
  endTime: END_TIME,
  isKeeperEvent: true,
  startTime: START_TIME,
  summary: "Interview with the candidate",
  uid: UID_A,
};

const presentWithSomeoneElsesIdentity: EventPresence = {
  event: eventAAtSharedPath,
  identifier: SHARED_PATH,
  status: "present",
};

interface ProviderCalls {
  deleted: string[][];
  pushed: string[];
  updated: { deleteId: string; eventId: string }[];
}

/* Every verb records what it was asked to do and then answers success, so an assertion that a verb
   was never called cannot be satisfied by a verb that failed for some unrelated reason. */
const createProvider = (calls: ProviderCalls): CalendarSyncProvider => ({
  deleteEvents: (eventIds: string[]): Promise<DeleteResult[]> => {
    calls.deleted.push([...eventIds]);
    return Promise.resolve(eventIds.map(() => ({ deletedSomething: true, success: true })));
  },
  listRemoteEvents: (): Promise<RemoteEvent[]> => Promise.resolve([]),
  prepareEvent: (): void => globalThis.undefined,
  pushEvents: (events: MaterializedSyncableEvent[]): Promise<PushResult[]> => {
    calls.pushed.push(...events.map((event) => event.id));
    return Promise.resolve(events.map((event) => ({
      deleteId: `/calendar/${event.id}.ics`,
      remoteId: `${event.id}@keeper.sh`,
      requestSent: true,
      success: true,
    })));
  },
  updateEvents: (updates: EventUpdate[]): Promise<PushResult[]> => {
    calls.updated.push(...updates.map((update) => ({
      deleteId: update.deleteId,
      eventId: update.event.id,
    })));
    return Promise.resolve(updates.map((update) => ({
      deleteId: update.deleteId,
      remoteId: UID_B,
      requestSent: true,
      success: true,
    })));
  },
  verifyEventsExist: (): Promise<EventPresence[]> =>
    Promise.resolve([presentWithSomeoneElsesIdentity]),
});

describe("a present answer carrying a different uid is never a located mirror", () => {
  it("never writes event B's body into the object the read said belongs to event A", async () => {
    const calls: ProviderCalls = { deleted: [], pushed: [], updated: [] };

    await executeRemoteOperations(
      [replacementB],
      [mappingB],
      DESTINATION_CALENDAR_ID,
      createProvider(calls),
      globalThis.undefined,
      globalThis.undefined,
      (_changes: PendingChanges) => Promise.resolve(true),
    );

    /* The read never confirmed that SHARED_PATH holds B, so a PUT there overwrites A's attendees,
       description and the recipient's own edits with B's body, unrecoverably. */
    expect(calls.updated).toEqual([]);
    /* Nor is the answer an absence: A's object really is standing there, and on CalDAV a create
       would post a second object under a uid the collection already holds. */
    expect(calls.pushed).toEqual([]);
    expect(calls.deleted).toEqual([]);
  });

  it("never rewrites the mapping's destination uid to the uid the other event serializes to", async () => {
    const calls: ProviderCalls = { deleted: [], pushed: [], updated: [] };

    const outcome = await executeRemoteOperations(
      [replacementB],
      [mappingB],
      DESTINATION_CALENDAR_ID,
      createProvider(calls),
      globalThis.undefined,
      globalThis.undefined,
      (_changes: PendingChanges) => Promise.resolve(true),
    );

    /* Mapping map-b adopting A's identity is the durable half of the damage: B's later removal issues a
       DELETE against A's object, and A's own mapping then reads remoteMissing. */
    const adoptedIdentity = (outcome.changes.updates ?? [])
      .filter((update) => update.destinationEventUid === UID_A);
    expect(adoptedIdentity).toEqual([]);
    expect(outcome.changes.deletes).toEqual([]);
  });

  it("reports the mapping as unsettled rather than running byte-identical to a healthy run", async () => {
    const calls: ProviderCalls = { deleted: [], pushed: [], updated: [] };

    const outcome = await executeRemoteOperations(
      [replacementB],
      [mappingB],
      DESTINATION_CALENDAR_ID,
      createProvider(calls),
      globalThis.undefined,
      globalThis.undefined,
      (_changes: PendingChanges) => Promise.resolve(true),
    );

    /* Doing nothing quietly is the failure that is hardest to notice, so the identity mismatch is
       counted and named rather than swallowed. */
    expect(outcome.verificationUnsettled).toBe(1);
    expect(outcome.result.parked ?? 0).toBe(1);
    expect(outcome.result.updated).toBe(0);
    expect(outcome.result.added).toBe(0);
    expect(outcome.errors.map((error) => error.error).join(" | ")).toContain(MAPPING_B);
  });
});
