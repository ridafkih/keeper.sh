import { describe, expect, it } from "bun:test";
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

  it("uses event identity conflict target when inserting rows", async () => {
    const rows: EventStateInsertRow[] = [
      {
        availability: "busy",
        calendarId: "calendar-1",
        endTime: new Date("2026-03-12T11:00:00.000Z"),
        sourceEventType: "default",
        sourceEventUid: "uid-1",
        startTime: new Date("2026-03-12T10:00:00.000Z"),
        title: "Focus Block",
      },
    ];

    const calls: {
      conflictConfig?: {
        set: Record<string, unknown>;
        target: unknown[];
      };
      insertedRows?: EventStateInsertRow[];
      insertTable?: typeof eventStatesTable;
    } = {};

    const database = {
      insert: (table: typeof eventStatesTable) => {
        calls.insertTable = table;
        return {
          values: (values: EventStateInsertRow[]) => {
            calls.insertedRows = values;
            return {
              onConflictDoUpdate: (config: {
                set: Record<string, unknown>;
                target: unknown[];
              }) => {
                calls.conflictConfig = config;
                return Promise.resolve();
              },
            };
          },
        };
      },
    };

    await insertEventStatesWithConflictResolution(database, rows);

    expect(calls.insertTable).toBe(eventStatesTable);
    expect(calls.insertedRows).toEqual(rows);
    expect(calls.conflictConfig?.target[0]).toBe(eventStatesTable.calendarId);
    expect(calls.conflictConfig?.target[1]).toBe(eventStatesTable.sourceEventUid);
    expect(calls.conflictConfig?.target[2]).toBe(eventStatesTable.startTime);
    expect(calls.conflictConfig?.target[3]).toBe(eventStatesTable.endTime);
    expect(Object.keys(calls.conflictConfig?.set ?? {}).toSorted()).toEqual([
      "availability",
      "description",
      "exceptionDates",
      "isAllDay",
      "location",
      "recurrenceRule",
      "sourceEventType",
      "startTimeZone",
      "title",
    ]);
  });
});
