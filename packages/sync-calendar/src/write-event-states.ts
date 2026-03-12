import { eventStatesTable } from "@keeper.sh/database/schema";
import { sql } from "drizzle-orm";

const EMPTY_ROW_COUNT = 0;

type EventStateInsertRow = typeof eventStatesTable.$inferInsert;

const EVENT_STATE_CONFLICT_TARGET: [
  typeof eventStatesTable.calendarId,
  typeof eventStatesTable.sourceEventUid,
  typeof eventStatesTable.startTime,
  typeof eventStatesTable.endTime,
] = [
  eventStatesTable.calendarId,
  eventStatesTable.sourceEventUid,
  eventStatesTable.startTime,
  eventStatesTable.endTime,
];

const excludedColumn = (columnName: string) => sql.raw(`excluded."${columnName}"`);

const EVENT_STATE_CONFLICT_SET = {
  availability: excludedColumn(eventStatesTable.availability.name),
  exceptionDates: excludedColumn(eventStatesTable.exceptionDates.name),
  isAllDay: excludedColumn(eventStatesTable.isAllDay.name),
  recurrenceRule: excludedColumn(eventStatesTable.recurrenceRule.name),
  sourceEventType: excludedColumn(eventStatesTable.sourceEventType.name),
  startTimeZone: excludedColumn(eventStatesTable.startTimeZone.name),
};

interface EventStateInsertClient {
  insert: (table: typeof eventStatesTable) => {
    values: (rows: EventStateInsertRow[]) => {
      onConflictDoUpdate: (config: {
        target: typeof EVENT_STATE_CONFLICT_TARGET;
        set: typeof EVENT_STATE_CONFLICT_SET;
      }) => Promise<unknown>;
    };
  };
}

const insertEventStatesWithConflictResolution = async (
  database: EventStateInsertClient,
  rows: EventStateInsertRow[],
): Promise<void> => {
  if (rows.length === EMPTY_ROW_COUNT) {
    return;
  }

  await database
    .insert(eventStatesTable)
    .values(rows)
    .onConflictDoUpdate({
      set: EVENT_STATE_CONFLICT_SET,
      target: EVENT_STATE_CONFLICT_TARGET,
    });
};

export { insertEventStatesWithConflictResolution };
export type { EventStateInsertClient, EventStateInsertRow };
