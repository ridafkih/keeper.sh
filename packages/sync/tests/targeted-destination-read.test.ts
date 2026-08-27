import { describe, expect, it } from "vitest";
import { computeSyncOperations } from "@keeper.sh/calendar";
import type {
  EventMapping,
  ListRemoteEventsOptions,
  MaterializedSyncableEvent,
  RemoteEvent,
} from "@keeper.sh/calendar";
import {
  createDestinationReconciliationScope,
  readDestinationRemoteEvents,
  TARGETED_DESTINATION_READ_LIMIT,
} from "../src/sync-user";

const SOURCE_CALENDAR_ID = "source-1";
const DESTINATION_CALENDAR_ID = "destination-1";

const REQUESTED_WINDOW = {
  timeMax: new Date("2026-08-01T00:00:00.000Z"),
  timeMin: new Date("2026-07-01T00:00:00.000Z"),
};

const EVENT_READ_DIAGNOSTICS = {
  candidateEventStateCount: 0,
  emptyTimeRangeCount: 0,
  excludedBySyncPolicyCount: 0,
  invertedTimeRangeCount: 0,
  materializedEventCount: 0,
  missingSourceEventUidCount: 0,
  outsideReconciliationWindowCount: 0,
  overBudgetSourceEventStateIds: [] as string[],
  overBudgetSourceEventUids: [] as string[],
  syncableEventCount: 0,
};

const createStartTime = (index: number): Date =>
  new Date(Date.UTC(2026, 6, 2, 10, 0, 0) + index * 60 * 60 * 1000);

const createEndTime = (index: number): Date =>
  new Date(createStartTime(index).getTime() + 30 * 60 * 1000);

const createLocalEvent = (index: number): MaterializedSyncableEvent => ({
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source",
  calendarUrl: null,
  endTime: createEndTime(index),
  eventStateId: `event-state-${index}`,
  id: `sync-event-${index}`,
  sourceEventUid: `source-uid-${index}`,
  startTime: createStartTime(index),
  summary: `Event ${index}`,
});

const createMapping = (index: number): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: `destination-event-${index}`,
  destinationEventUid: `destination-uid-${index}`,
  endTime: createEndTime(index),
  eventStateId: `event-state-${index}`,
  id: `mapping-${index}`,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: createStartTime(index),
  syncEventHash: "hash-recorded-at-last-push",
  syncEventId: `sync-event-${index}`,
});

const createRemoteEvent = (index: number): RemoteEvent => ({
  deleteId: `destination-event-${index}`,
  endTime: createEndTime(index),
  isKeeperEvent: true,
  startTime: createStartTime(index),
  uid: `destination-uid-${index}`,
});

interface RecordedRead {
  ids: string[] | null;
  kind: "list" | "targeted";
  window: ListRemoteEventsOptions | null;
}

const createProviderDouble = (presentRemoteEvents: RemoteEvent[]) => {
  const reads: RecordedRead[] = [];
  const remoteEventsByDeleteId = new Map(
    presentRemoteEvents.map((remoteEvent) => [remoteEvent.deleteId, remoteEvent]),
  );
  return {
    getRemoteEventsByIds: (ids: string[]): Promise<RemoteEvent[]> => {
      reads.push({ ids: [...ids], kind: "targeted", window: null });
      const found: RemoteEvent[] = [];
      for (const id of ids) {
        const remoteEvent = remoteEventsByDeleteId.get(id);
        if (remoteEvent) {
          found.push(remoteEvent);
        }
      }
      return Promise.resolve(found);
    },
    listRemoteEvents: (options: ListRemoteEventsOptions): Promise<RemoteEvent[]> => {
      reads.push({ ids: null, kind: "list", window: options });
      return Promise.resolve([...remoteEventsByDeleteId.values()]);
    },
    reads,
  };
};

const createScope = (authoritativeMappingIds: ReadonlySet<string> | null) =>
  createDestinationReconciliationScope({
    authoritativeMappingIds,
    authoritativeSourceWindows: new Map([[SOURCE_CALENDAR_ID, REQUESTED_WINDOW]]),
    authoritativeWindow: REQUESTED_WINDOW,
    eventReadDiagnostics: EVENT_READ_DIAGNOSTICS,
    requestedWindow: REQUESTED_WINDOW,
    sourceCalendarIdsAtLocalRead: [SOURCE_CALENDAR_ID],
  });

describe("the push path reads only what it writes", () => {
  const TOUCHED_INDEXES = [1, 2, 3];
  const localEvents = TOUCHED_INDEXES.map((index) => createLocalEvent(index));
  const existingMappings = TOUCHED_INDEXES.map((index) => createMapping(index));
  // The mirror of event 2 no longer exists on the destination: the 1% drift case.
  const presentRemoteEvents = [createRemoteEvent(1), createRemoteEvent(3)];

  it("looks up only the mapped destination events the plan touches", async () => {
    const provider = createProviderDouble(presentRemoteEvents);

    const remoteRead = await readDestinationRemoteEvents({
      existingMappings,
      localEvents,
      provider,
      requestedWindow: REQUESTED_WINDOW,
    });

    expect(provider.reads.map((read) => read.kind)).toEqual(["targeted"]);
    expect(provider.reads[0]?.ids?.toSorted()).toEqual([
      "destination-event-1",
      "destination-event-2",
      "destination-event-3",
    ]);
    expect(remoteRead.remoteEvents).toEqual(presentRemoteEvents);
    expect(remoteRead.authoritativeMappingIds).toEqual(
      new Set(["mapping-1", "mapping-2", "mapping-3"]),
    );
  });

  it("plans the same operations from the targeted read as from the full listing", async () => {
    const provider = createProviderDouble(presentRemoteEvents);

    const remoteRead = await readDestinationRemoteEvents({
      existingMappings,
      localEvents,
      provider,
      requestedWindow: REQUESTED_WINDOW,
    });
    const targeted = computeSyncOperations(
      localEvents,
      existingMappings,
      remoteRead.remoteEvents,
      createScope(remoteRead.authoritativeMappingIds),
    );
    const listed = computeSyncOperations(
      localEvents,
      existingMappings,
      await provider.listRemoteEvents(REQUESTED_WINDOW),
      createScope(null),
    );

    expect(targeted.operations).toEqual(listed.operations);
    expect(targeted.staleMappingIds.toSorted()).toEqual(listed.staleMappingIds.toSorted());
    expect(targeted.operations).toContainEqual({
      deleteId: "destination-event-2",
      event: localEvents[1],
      remoteMissing: true,
      staleMappingId: "mapping-2",
      type: "replace",
      uid: "destination-uid-2",
    });
  });

  it("falls back to one windowed listing when the plan touches more than the limit", async () => {
    const overLimitIndexes = Array.from(
      { length: TARGETED_DESTINATION_READ_LIMIT + 1 },
      (unused, offset) => offset + 1,
    );
    const provider = createProviderDouble(overLimitIndexes.map((index) => createRemoteEvent(index)));

    const remoteRead = await readDestinationRemoteEvents({
      existingMappings: overLimitIndexes.map((index) => createMapping(index)),
      localEvents: overLimitIndexes.map((index) => createLocalEvent(index)),
      provider,
      requestedWindow: REQUESTED_WINDOW,
    });

    expect(provider.reads.map((read) => read.kind)).toEqual(["list"]);
    expect(provider.reads[0]?.window).toEqual(REQUESTED_WINDOW);
    expect(remoteRead.authoritativeMappingIds).toBeNull();
    expect(remoteRead.remoteEvents).toHaveLength(overLimitIndexes.length);
  });

  it("still reads by id at exactly the limit", async () => {
    const atLimitIndexes = Array.from(
      { length: TARGETED_DESTINATION_READ_LIMIT },
      (unused, offset) => offset + 1,
    );
    const provider = createProviderDouble(atLimitIndexes.map((index) => createRemoteEvent(index)));

    await readDestinationRemoteEvents({
      existingMappings: atLimitIndexes.map((index) => createMapping(index)),
      localEvents: atLimitIndexes.map((index) => createLocalEvent(index)),
      provider,
      requestedWindow: REQUESTED_WINDOW,
    });

    expect(provider.reads.map((read) => read.kind)).toEqual(["targeted"]);
  });
});
