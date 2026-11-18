import { describe, expect, it } from "vitest";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import type { ReconciliationScope } from "../../../src/core/sync/operations";
import {
  buildOwnershipScope,
  selectOwnerTagBackfill,
} from "../../../src/core/sync/event-ownership";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, RemoteEvent } from "../../../src/core/types";

const WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

const OURS = "destination-ours";
const THEIRS = "destination-theirs";

const localEvent = (id: string): MaterializedSyncableEvent => ({
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  id,
  sourceEventUid: `source-${id}`,
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  summary: "Meeting",
});

const untrackedKeeperEvent = (uid: string): RemoteEvent => ({
  deleteId: `delete-${uid}`,
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  isKeeperEvent: true,
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  uid,
});

const remoteKeeperEvent = (uid: string, ownerTag: string | null): RemoteEvent => ({
  ...untrackedKeeperEvent(uid),
  ownerTag,
});

const mapping = (overrides: Partial<EventMapping>): EventMapping => ({
  calendarId: OURS,
  deleteIdentifier: "delete-mapped-uid",
  destinationEventUid: "mapped-uid",
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  eventStateId: "event-1",
  id: "mapping-1",
  sourceCalendarId: "source-calendar-id",
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  syncEventHash: "hash",
  syncEventId: "event-1",
  ...overrides,
});

const provider = {
  deriveEventUids: (event: MaterializedSyncableEvent) => [`derived-${event.id}`],
  ownerTag: OURS,
};

const scopeFor = (localEvents: MaterializedSyncableEvent[]): ReconciliationScope => ({
  authoritativeWindow: WINDOW,
  ownership: buildOwnershipScope(provider, localEvents) ?? { ownerTag: OURS, provenUntaggedUids: new Set() },
  requestedWindow: WINDOW,
});

const removedUids = (remoteEvents: RemoteEvent[], localEvents: MaterializedSyncableEvent[] = []) =>
  computeSyncOperations(localEvents, [], remoteEvents, scopeFor(localEvents))
    .operations
    .filter((operation) => operation.type === "remove")
    .map((operation) => operation.uid);

describe("orphan cleanup in a calendar another Keeper.sh destination also writes to", () => {
  it("leaves an event tagged by another destination alone", () => {
    expect(removedUids([remoteKeeperEvent("theirs", THEIRS)])).toEqual([]);
  });

  it("removes an orphan carrying this destination's tag", () => {
    expect(removedUids([remoteKeeperEvent("ours", OURS)])).toEqual(["ours"]);
  });

  it("leaves an untagged event it cannot prove it wrote", () => {
    expect(removedUids([remoteKeeperEvent("unknown", null)])).toEqual([]);
  });

  it("removes an untagged event whose UID it derives for an event it mirrors", () => {
    const event = localEvent("event-9");
    const removed = removedUids([remoteKeeperEvent("derived-event-9", null)], [event]);

    expect(removed).toEqual(["derived-event-9"]);
  });

  it("keeps removing orphans for providers that do not tag their events", () => {
    const { operations } = computeSyncOperations(
      [],
      [],
      [untrackedKeeperEvent("untracked")],
      { authoritativeWindow: WINDOW, requestedWindow: WINDOW },
    );

    expect(operations.map((operation) => operation.type)).toEqual(["remove"]);
  });
});

describe("tagging mirrors written before ownership tags", () => {
  const event = localEvent("event-1");
  const input = (remoteEvents: RemoteEvent[], mappedRemote: RemoteEvent, limit = 10) => ({
    excludedMappingIds: new Set<string>(),
    limit,
    localEventsById: new Map([[event.id, event]]),
    mappings: [mapping({}), mapping({ id: "mapping-2", syncEventId: "event-1" })],
    ownerTag: OURS,
    remoteEvents,
    remoteEventsByMappingId: new Map([["mapping-1", mappedRemote], ["mapping-2", mappedRemote]]),
  });

  it("claims only one mirror until a tag is seen to survive on the calendar", () => {
    const untagged = remoteKeeperEvent("mapped-uid", null);

    expect(selectOwnerTagBackfill(input([untagged], untagged))).toHaveLength(1);
  });

  it("claims up to the limit once the calendar keeps this destination's tag", () => {
    const untagged = remoteKeeperEvent("mapped-uid", null);
    const tagged = remoteKeeperEvent("other-uid", OURS);

    expect(selectOwnerTagBackfill(input([untagged, tagged], untagged))).toHaveLength(2);
  });

  it("never claims a mirror that is already tagged", () => {
    const tagged = remoteKeeperEvent("mapped-uid", OURS);

    expect(selectOwnerTagBackfill(input([tagged], tagged))).toEqual([]);
  });

  it("leaves mirrors this run already rewrites or removes", () => {
    const untagged = remoteKeeperEvent("mapped-uid", null);
    const excluded = { ...input([untagged], untagged), excludedMappingIds: new Set(["mapping-1", "mapping-2"]) };

    expect(selectOwnerTagBackfill(excluded)).toEqual([]);
  });
});
