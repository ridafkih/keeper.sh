import { describe, expect, it } from "vitest";
import { eventStatesTable } from "@keeper.sh/database/schema";
import type { EventStateInsertRow } from "../../../src/core/source/write-event-states";
import { insertEventStatesWithConflictResolution } from "../../../src/core/source/write-event-states";

describe("insertEventStatesWithConflictResolution", () => {
  it("skips database writes when there are no rows", async () => {
    let insertCalled = false;

    const database = {
      insert: () => {
        insertCalled = true;
        return {
          values: () => ({
            onConflictDoUpdate: () => Promise.resolve(),
          }),
        };
      },
    };

    await insertEventStatesWithConflictResolution(database, []);

    expect(insertCalled).toBe(false);
  });

  it("uses provider identity for provider rows and storage identity for legacy rows", async () => {
    const rows: EventStateInsertRow[] = [
      {
        availability: "busy",
        calendarId: "calendar-1",
        endTime: new Date("2026-03-12T11:00:00.000Z"),
        sourceEventId: "provider-event-1",
        sourceEventType: "default",
        sourceEventUid: "uid-1",
        startTime: new Date("2026-03-12T10:00:00.000Z"),
        title: "Focus Block",
      },
      {
        calendarId: "calendar-1",
        endTime: new Date("2026-03-13T11:00:00.000Z"),
        sourceEventUid: "legacy-uid-1",
        startTime: new Date("2026-03-13T10:00:00.000Z"),
      },
    ];

    const calls: {
      conflictConfig: {
        set: Record<string, unknown>;
        target: unknown[];
        targetWhere: unknown;
      };
      insertedRows: EventStateInsertRow[];
      insertTable: typeof eventStatesTable;
    }[] = [];

    const database = {
      insert: (table: typeof eventStatesTable) => ({
        values: (values: EventStateInsertRow[]) => ({
          onConflictDoUpdate: (config: {
            set: Record<string, unknown>;
            target: unknown[];
            targetWhere: unknown;
          }) => {
            calls.push({
              conflictConfig: config,
              insertedRows: values,
              insertTable: table,
            });
            return Promise.resolve();
          },
        }),
      }),
    };

    await insertEventStatesWithConflictResolution(database, rows);

    expect(calls).toHaveLength(2);
    const [providerCall, legacyCall] = calls;
    expect(providerCall?.insertTable).toBe(eventStatesTable);
    expect(providerCall?.insertedRows).toEqual([rows[0]]);
    expect(providerCall?.conflictConfig.target).toEqual([
      eventStatesTable.calendarId,
      eventStatesTable.sourceEventId,
    ]);
    expect(providerCall?.conflictConfig.targetWhere).toBeDefined();
    expect(Object.keys(providerCall?.conflictConfig.set ?? {}).toSorted()).toEqual([
      "availability",
      "description",
      "endTime",
      "exceptionDates",
      "isAllDay",
      "location",
      "recurrenceId",
      "recurrenceRule",
      "sourceEventId",
      "sourceEventType",
      "sourceEventUid",
      "startTime",
      "startTimeZone",
      "title",
    ]);
    expect(legacyCall?.insertTable).toBe(eventStatesTable);
    expect(legacyCall?.insertedRows).toEqual([rows[1]]);
    expect(legacyCall?.conflictConfig.target).toEqual([
      eventStatesTable.calendarId,
      eventStatesTable.sourceEventUid,
      eventStatesTable.startTime,
      eventStatesTable.endTime,
    ]);
    expect(legacyCall?.conflictConfig.targetWhere).toBeDefined();
  });
});
