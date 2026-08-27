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

const replacementB: SyncOperation = {
  deleteId: SHARED_PATH,
  event: localEventB,
  remoteMissing: true,
  staleMappingId: MAPPING_B,
  type: "replace",
  uid: UID_B,
};

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

    expect(calls.updated).toEqual([]);
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

    expect(outcome.verificationUnsettled).toBe(1);
    expect(outcome.result.parked ?? 0).toBe(1);
    expect(outcome.result.updated).toBe(0);
    expect(outcome.result.added).toBe(0);
    expect(outcome.errors.map((error) => error.error).join(" | ")).toContain(MAPPING_B);
  });
});
