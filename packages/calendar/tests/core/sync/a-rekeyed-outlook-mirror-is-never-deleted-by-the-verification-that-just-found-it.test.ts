import { describe, expect, it } from "vitest";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, RemoteEvent } from "../../../src/core/types";

/* Graph re-keys an item in place, so the id the mapping holds dies while the iCalUId survives. A
   modern Outlook mapping never has deleteIdentifier === destinationEventUid -- the first is a Graph
   item id, the second an iCalUId -- so the uid fallback that recognises a re-keyed mirror is closed
   to exactly the provider that re-keys. */
const OLD_GRAPH_ID = "AAMkAGold-graph-id";
const NEW_GRAPH_ID = "AAMkAGnew-graph-id";
const MIRROR_UID = "keeper-uid-1@keeper.sh";

const START_TIME = new Date("2026-09-01T15:00:00.000Z");
const END_TIME = new Date("2026-09-01T16:00:00.000Z");

const RECONCILIATION_SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

const localEvent: MaterializedSyncableEvent = {
  calendarId: "source-cal-1",
  calendarName: "Work",
  calendarUrl: null,
  endTime: END_TIME,
  id: "sync-event-1",
  sourceEventUid: "source-uid-1",
  startTime: START_TIME,
  summary: "Quarterly review — moved to Thursday",
};

const mapping: EventMapping = {
  calendarId: "destination-cal-1",
  deleteIdentifier: OLD_GRAPH_ID,
  destinationEventUid: MIRROR_UID,
  endTime: END_TIME,
  eventStateId: localEvent.id,
  id: "mapping-id-1",
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: "hash-recorded-before-the-source-edit",
  syncEventId: localEvent.id,
};

/* What the destination read hands back: the mapping's own mirror, alive, under its new item id. */
const rekeyedMirror: RemoteEvent = {
  deleteId: NEW_GRAPH_ID,
  endTime: END_TIME,
  isKeeperEvent: true,
  startTime: START_TIME,
  summary: "Quarterly review",
  uid: MIRROR_UID,
};

describe("a re-keyed Outlook mirror is matched to its own mapping", () => {
  it("plans no remove against the mirror the read just found alive", () => {
    const { operations } = computeSyncOperations(
      [localEvent],
      [mapping],
      [rekeyedMirror],
      RECONCILIATION_SCOPE,
    );

    /* A remove here is a DELETE of the customer's live event at its new id: attendee responses,
       reminders and categories gone, then re-created by a create-only POST that may fail. */
    expect(operations.filter((operation) => operation.type === "remove")).toEqual([]);
  });

  it("does not call the mapping's mirror missing when the read returned it", () => {
    const { operations } = computeSyncOperations(
      [localEvent],
      [mapping],
      [rekeyedMirror],
      RECONCILIATION_SCOPE,
    );

    const replacements = operations.filter((operation) => operation.type === "replace");
    expect(replacements).toHaveLength(1);
    expect(replacements[0]).toMatchObject({
      deleteId: NEW_GRAPH_ID,
      staleMappingId: mapping.id,
      uid: MIRROR_UID,
    });
    expect(replacements[0]).not.toHaveProperty("remoteMissing", true);
  });
});
