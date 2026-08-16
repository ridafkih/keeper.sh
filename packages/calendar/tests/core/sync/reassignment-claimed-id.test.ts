import { describe, expect, it } from "vitest";
import { pairReidentifiedMaterializedOccurrences } from "../../../src/core/sync/operations";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent } from "../../../src/core/types";

const OWNER = "event-state-1";
const IN_WINDOW_START = new Date("2026-08-16T10:00:00.000Z");
const IN_WINDOW_END = new Date("2026-08-16T11:00:00.000Z");

const materializedEvent = (id: string): MaterializedSyncableEvent => ({
  calendarId: "source-calendar-1",
  endTime: IN_WINDOW_END,
  eventStateId: OWNER,
  id,
  startTime: IN_WINDOW_START,
} as MaterializedSyncableEvent);

const mapping = (id: string, syncEventId: string): EventMapping => ({
  calendarId: "destination-calendar-1",
  destinationEventUid: `dest-${id}`,
  endTime: IN_WINDOW_END,
  eventStateId: OWNER,
  id,
  sourceCalendarId: "source-calendar-1",
  startTime: IN_WINDOW_START,
  syncEventId,
} as EventMapping);

/*
 * The mapping that already holds the id sits outside the window this pass has authority
 * over, so it is absent from the reassignable set. It is still in the table, and the unique
 * index still enforces it.
 */
describe("an occurrence whose id another mapping already holds", () => {
  it("is not reassigned onto that id when the holder is outside the pass window", () => {
    const reassignable = [mapping("mapping-in-window", "orphaned-sync-id")];
    const all = [
      ...reassignable,
      mapping("mapping-outside-window", "occurrence-1"),
    ];

    const reassignments = pairReidentifiedMaterializedOccurrences(
      [materializedEvent("occurrence-1")],
      reassignable,
      all,
    );

    expect(reassignments).toEqual([]);
  });

  it("still reassigns an occurrence no mapping anywhere holds", () => {
    const reassignable = [mapping("mapping-in-window", "orphaned-sync-id")];

    const reassignments = pairReidentifiedMaterializedOccurrences(
      [materializedEvent("occurrence-1")],
      reassignable,
      reassignable,
    );

    expect(reassignments).toHaveLength(1);
    expect(reassignments[0]?.event.id).toBe("occurrence-1");
    expect(reassignments[0]?.mapping.id).toBe("mapping-in-window");
  });
});
