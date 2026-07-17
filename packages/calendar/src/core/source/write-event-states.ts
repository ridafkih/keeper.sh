import { eventStatesTable } from "@keeper.sh/database/schema";
import { isNotNull, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

const EMPTY_ROW_COUNT = 0;

type EventStateInsertRow = typeof eventStatesTable.$inferInsert;

const LEGACY_EVENT_STATE_CONFLICT_TARGET: [
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

const PROVIDER_EVENT_STATE_CONFLICT_TARGET: [
  typeof eventStatesTable.calendarId,
  typeof eventStatesTable.sourceEventId,
] = [
  eventStatesTable.calendarId,
  eventStatesTable.sourceEventId,
];

const excludedColumn = (columnName: string) => sql.raw(`excluded."${columnName}"`);

const EVENT_STATE_CONFLICT_SET = {
  availability: excludedColumn(eventStatesTable.availability.name),
  description: excludedColumn(eventStatesTable.description.name),
  exceptionDates: excludedColumn(eventStatesTable.exceptionDates.name),
  isAllDay: excludedColumn(eventStatesTable.isAllDay.name),
  location: excludedColumn(eventStatesTable.location.name),
  recurrenceRule: excludedColumn(eventStatesTable.recurrenceRule.name),
  recurrenceId: excludedColumn(eventStatesTable.recurrenceId.name),
  sourceEventId: excludedColumn(eventStatesTable.sourceEventId.name),
  sourceEventType: excludedColumn(eventStatesTable.sourceEventType.name),
  startTimeZone: excludedColumn(eventStatesTable.startTimeZone.name),
  title: excludedColumn(eventStatesTable.title.name),
};

const PROVIDER_EVENT_STATE_CONFLICT_SET = {
  ...EVENT_STATE_CONFLICT_SET,
  endTime: excludedColumn(eventStatesTable.endTime.name),
  sourceEventUid: excludedColumn(eventStatesTable.sourceEventUid.name),
  startTime: excludedColumn(eventStatesTable.startTime.name),
};

type EventStateConflictTarget =
  | typeof LEGACY_EVENT_STATE_CONFLICT_TARGET
  | typeof PROVIDER_EVENT_STATE_CONFLICT_TARGET;

interface EventStateConflictConfig {
  target: EventStateConflictTarget;
  targetWhere: SQL;
  set: Record<string, SQL>;
}

interface EventStateInsertClient {
  insert: (table: typeof eventStatesTable) => {
    values: (rows: EventStateInsertRow[]) => {
      onConflictDoUpdate: (config: EventStateConflictConfig) => Promise<unknown>;
    };
  };
}

const insertEventStateRows = async (
  database: EventStateInsertClient,
  rows: EventStateInsertRow[],
  conflictConfig: EventStateConflictConfig,
): Promise<void> => {
  if (rows.length === EMPTY_ROW_COUNT) {
    return;
  }

  await database
    .insert(eventStatesTable)
    .values(rows)
    .onConflictDoUpdate(conflictConfig);
};

const insertEventStatesWithConflictResolution = async (
  database: EventStateInsertClient,
  rows: EventStateInsertRow[],
): Promise<void> => {
  const providerRows: EventStateInsertRow[] = [];
  const legacyRows: EventStateInsertRow[] = [];

  for (const row of rows) {
    if (row.sourceEventId) {
      providerRows.push(row);
    } else {
      legacyRows.push(row);
    }
  }

  await insertEventStateRows(database, providerRows, {
    set: PROVIDER_EVENT_STATE_CONFLICT_SET,
    target: PROVIDER_EVENT_STATE_CONFLICT_TARGET,
    targetWhere: isNotNull(eventStatesTable.sourceEventId),
  });
  await insertEventStateRows(database, legacyRows, {
    set: EVENT_STATE_CONFLICT_SET,
    target: LEGACY_EVENT_STATE_CONFLICT_TARGET,
    targetWhere: isNull(eventStatesTable.sourceEventId),
  });
};

export { insertEventStatesWithConflictResolution };
export type { EventStateInsertRow, EventStateInsertClient };
