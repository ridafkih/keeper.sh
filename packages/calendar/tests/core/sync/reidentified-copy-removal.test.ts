import { describe, expect, it } from "vitest";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import type { MaterializedSyncableEvent } from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";

const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");

const SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

const EVENT: MaterializedSyncableEvent = {
  calendarId: "source-cal",
  calendarName: "Personal",
  calendarUrl: null,
  endTime: END_TIME,
  id: "ev-1",
  sourceEventUid: "source-uid-1",
  startTime: START_TIME,
  summary: "Quarterly review",
};

const MAPPING: EventMapping = {
  calendarId: "dest-cal",
  deleteIdentifier: "graph-id-before-the-restore",
  destinationEventUid: "040000008200E00074C5B7101A82E008@keeper.sh",
  endTime: END_TIME,
  eventStateId: "ev-1",
  id: "map-1",
  sourceCalendarId: "source-cal",
  startTime: START_TIME,
  syncEventHash: createSyncEventContentHash(EVENT),
  syncEventId: "ev-1",
};

const REIDENTIFIED_REMOTE = {
  deleteId: "graph-id-after-the-restore",
  endTime: END_TIME,
  isKeeperEvent: true,
  startTime: START_TIME,
  uid: MAPPING.destinationEventUid,
};

describe("a copy the destination reidentified", () => {
  it("is not deleted off the destination while write-back holds its mapping", () => {
    const { operations } = computeSyncOperations(
      [EVENT],
      [MAPPING],
      [REIDENTIFIED_REMOTE],
      SCOPE,
      new Set([MAPPING.id]),
    );

    expect(operations.filter((operation) => operation.type === "remove")).toEqual([]);
  });
});
