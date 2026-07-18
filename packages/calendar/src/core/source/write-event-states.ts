import { eventStatesTable } from "@keeper.sh/database/schema";
import { isNotNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { IcsExceptionDates, IcsRecurrenceRule } from "ts-ics";
import type { SourceEvent } from "../types";

const EMPTY_ROW_COUNT = 0;

type EventStateInsertRow = typeof eventStatesTable.$inferInsert;

const serializeOptionalJson = (
  value: IcsExceptionDates | IcsRecurrenceRule | undefined,
): string | null => {
  if (!value) {
    return null;
  }
  return JSON.stringify(value);
};

const buildEventStateInsertRow = (
  calendarId: string,
  event: SourceEvent,
): EventStateInsertRow => ({
  availability: event.availability,
  calendarId,
  description: event.description,
  endTime: event.endTime,
  exceptionDates: serializeOptionalJson(event.exceptionDates),
  isAllDay: event.isAllDay,
  location: event.location,
  recurrenceId: event.recurrenceId,
  recurrenceRule: serializeOptionalJson(event.recurrenceRule),
  sourceEventId: event.sourceEventId,
  sourceEventType: event.sourceEventType ?? "default",
  sourceEventUid: event.uid,
  startTime: event.startTime,
  startTimeZone: event.startTimeZone,
  title: event.title,
});

const LEGACY_RECURRING_EVENT_STATE_CONFLICT_TARGET: [
  typeof eventStatesTable.calendarId,
  typeof eventStatesTable.sourceEventUid,
  typeof eventStatesTable.recurrenceId,
] = [
  eventStatesTable.calendarId,
  eventStatesTable.sourceEventUid,
  eventStatesTable.recurrenceId,
];

const LEGACY_NON_RECURRING_EVENT_STATE_CONFLICT_TARGET: [
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
  sourceEventUid: excludedColumn(eventStatesTable.sourceEventUid.name),
  startTime: excludedColumn(eventStatesTable.startTime.name),
  startTimeZone: excludedColumn(eventStatesTable.startTimeZone.name),
  endTime: excludedColumn(eventStatesTable.endTime.name),
  title: excludedColumn(eventStatesTable.title.name),
};

const PROVIDER_EVENT_STATE_CONFLICT_SET = EVENT_STATE_CONFLICT_SET;

type EventStateConflictTarget =
  | typeof LEGACY_RECURRING_EVENT_STATE_CONFLICT_TARGET
  | typeof LEGACY_NON_RECURRING_EVENT_STATE_CONFLICT_TARGET
  | typeof PROVIDER_EVENT_STATE_CONFLICT_TARGET;

interface EventStateConflictConfig {
  target: EventStateConflictTarget;
  targetWhere: SQL;
  set: Record<string, SQL>;
}

interface EventStateInsertClient {
  insert: (table: typeof eventStatesTable) => {
    values: {
      (row: EventStateInsertRow): {
        onConflictDoUpdate: (config: EventStateConflictConfig) => Promise<unknown>;
      };
      (rows: EventStateInsertRow[]): {
      onConflictDoUpdate: (config: EventStateConflictConfig) => Promise<unknown>;
      };
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
  const legacyRecurringRows: EventStateInsertRow[] = [];
  const legacyNonRecurringRows: EventStateInsertRow[] = [];

  for (const row of rows) {
    if (row.sourceEventId) {
      providerRows.push(row);
    } else if (row.recurrenceId) {
      legacyRecurringRows.push(row);
    } else {
      legacyNonRecurringRows.push(row);
    }
  }

  await insertEventStateRows(database, providerRows, {
    set: PROVIDER_EVENT_STATE_CONFLICT_SET,
    target: PROVIDER_EVENT_STATE_CONFLICT_TARGET,
    targetWhere: isNotNull(eventStatesTable.sourceEventId),
  });
  await insertEventStateRows(database, legacyRecurringRows, {
    set: EVENT_STATE_CONFLICT_SET,
    target: LEGACY_RECURRING_EVENT_STATE_CONFLICT_TARGET,
    targetWhere: sql`${eventStatesTable.sourceEventId} is null and ${eventStatesTable.recurrenceId} is not null`,
  });
  await insertEventStateRows(database, legacyNonRecurringRows, {
    set: EVENT_STATE_CONFLICT_SET,
    target: LEGACY_NON_RECURRING_EVENT_STATE_CONFLICT_TARGET,
    targetWhere: sql`${eventStatesTable.sourceEventId} is null and ${eventStatesTable.recurrenceId} is null`,
  });
};

export { buildEventStateInsertRow, insertEventStatesWithConflictResolution };
export type { EventStateInsertRow, EventStateInsertClient };
