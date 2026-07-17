import {
  calendarAccountsTable,
  calendarsTable,
  eventStatesTable,
  userEventsTable,
} from "@keeper.sh/database/schema";
import { normalizeDateRange } from "@/utils/date-range";
import { and, arrayContains, asc, eq, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  materializeRecurrenceEvents,
  parseStoredIcsExceptionDates,
  parseStoredIcsRecurrenceRule,
} from "@keeper.sh/calendar";
import type { SyncableEvent } from "@keeper.sh/calendar";

import type { KeeperDatabase, KeeperEvent, KeeperEventFilters, KeeperEventRangeInput } from "@/types";

const EMPTY_RESULT_COUNT = 0;

const orAbsent = <TValue>(value: TValue | null): TValue | undefined => {
  if (value === null) {
    return;
  }
  return value;
};

const toRequiredDate = (value: Date | string, label: "from" | "to"): Date => {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new TypeError(`Invalid ${label} date`);
  }
  return parsedDate;
};

const normalizeEventRange = (
  range: KeeperEventRangeInput,
): {
  start: Date;
  end: Date;
} => normalizeDateRange(
  toRequiredDate(range.from, "from"),
  toRequiredDate(range.to, "to"),
);

interface SourceInfo {
  name: string;
  provider: string;
  url: string | null;
  userId: string;
}

const getSourcesForUser = async (
  database: KeeperDatabase,
  userId: string,
  filters?: KeeperEventFilters,
): Promise<{ calendarIds: string[]; sourceMap: Map<string, SourceInfo> }> => {
  const sourceConditions: SQL[] = [
    eq(calendarsTable.userId, userId),
    arrayContains(calendarsTable.capabilities, ["pull"]),
  ];

  if (filters?.calendarId && filters.calendarId.length > 0) {
    sourceConditions.push(inArray(calendarsTable.id, filters.calendarId));
  }

  const sources = await database
    .select({
      id: calendarsTable.id,
      name: calendarsTable.name,
      provider: calendarAccountsTable.provider,
      url: calendarsTable.url,
      userId: calendarsTable.userId,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(and(...sourceConditions));

  const calendarIds = sources.map((source) => source.id);
  const sourceMap = new Map(
    sources.map((source) => [
      source.id,
      { name: source.name, provider: source.provider, url: source.url, userId: source.userId },
    ]),
  );

  return { calendarIds, sourceMap };
};

interface SyncedEventRow {
  calendarId: string;
  description: string | null;
  endTime: Date;
  exceptionDates: string | null;
  id: string;
  location: string | null;
  recurrenceId: Date | null;
  recurrenceRule: string | null;
  sourceEventUid: string | null;
  startTime: Date;
  startTimeZone: string | null;
  title: string | null;
}

interface UserEventRow {
  calendarId: string;
  description: string | null;
  endTime: Date;
  id: string;
  location: string | null;
  startTime: Date;
  title: string | null;
}

type FlattenedEvent = UserEventRow;

const flattenSyncedEvents = (
  rows: SyncedEventRow[],
  sourceMap: Map<string, SourceInfo>,
  windowStart: Date,
  windowEnd: Date,
): FlattenedEvent[] => {
  const events: SyncableEvent[] = rows.flatMap((row) => {
    const source = sourceMap.get(row.calendarId);
    if (!source) {
      return [];
    }
    return [{
      calendarId: row.calendarId,
      calendarName: source.name,
      calendarUrl: source.url,
      description: orAbsent(row.description),
      endTime: row.endTime,
      exceptionDates: parseStoredIcsExceptionDates(row.exceptionDates, row.id)
        ?.map((exceptionDate) => exceptionDate.date),
      id: row.id,
      location: orAbsent(row.location),
      recurrenceId: orAbsent(row.recurrenceId),
      recurrenceRule: orAbsent(parseStoredIcsRecurrenceRule(row.recurrenceRule, row.id)),
      sourceEventUid: row.sourceEventUid ?? row.id,
      startTime: row.startTime,
      startTimeZone: orAbsent(row.startTimeZone),
      summary: row.title ?? "",
    }];
  });
  const exclusiveWindowEnd = new Date(windowEnd.getTime() + 1);
  return materializeRecurrenceEvents(events, {
    end: exclusiveWindowEnd,
    start: windowStart,
  }).map((occurrence) => ({
    calendarId: occurrence.calendarId,
    description: occurrence.description ?? null,
    endTime: occurrence.endTime,
    id: occurrence.id,
    location: occurrence.location ?? null,
    startTime: occurrence.startTime,
    title: occurrence.summary || null,
  }));
};

/**
 * Build the WHERE clause for fetching synced rows that may contribute events
 * to [start, end]: one-offs whose startTime is in-window, plus recurring
 * masters whose first occurrence is at-or-before the window end (later
 * occurrences may still land inside the window even if the master is far in
 * the past).
 */
const buildSyncedRangeCondition = (start: Date, end: Date): SQL | undefined =>
  or(
    and(
      isNull(eventStatesTable.recurrenceRule),
      isNull(eventStatesTable.recurrenceId),
      gte(eventStatesTable.startTime, start),
      lte(eventStatesTable.startTime, end),
    ),
    and(
      isNotNull(eventStatesTable.recurrenceRule),
      lte(eventStatesTable.startTime, end),
    ),
    isNotNull(eventStatesTable.recurrenceId),
  );

const getEventsInRange = async (
  database: KeeperDatabase,
  userId: string,
  range: KeeperEventRangeInput,
  filters?: KeeperEventFilters,
): Promise<KeeperEvent[]> => {
  const { start, end } = normalizeEventRange(range);
  const { calendarIds, sourceMap } = await getSourcesForUser(database, userId, filters);

  if (calendarIds.length === EMPTY_RESULT_COUNT) {
    return [];
  }

  const syncedConditions: SQL[] = [
    inArray(eventStatesTable.calendarId, calendarIds),
  ];
  const syncedRangeCondition = buildSyncedRangeCondition(start, end);
  if (syncedRangeCondition) {
    syncedConditions.push(syncedRangeCondition);
  }

  if (filters?.availability && filters.availability.length > 0) {
    syncedConditions.push(inArray(eventStatesTable.availability, filters.availability));
  }
  if (filters && "isAllDay" in filters && typeof filters.isAllDay === "boolean") {
    syncedConditions.push(eq(eventStatesTable.isAllDay, filters.isAllDay));
  }

  const syncedRows: SyncedEventRow[] = await database
    .select({
      calendarId: eventStatesTable.calendarId,
      description: eventStatesTable.description,
      endTime: eventStatesTable.endTime,
      exceptionDates: eventStatesTable.exceptionDates,
      id: eventStatesTable.id,
      location: eventStatesTable.location,
      recurrenceId: eventStatesTable.recurrenceId,
      recurrenceRule: eventStatesTable.recurrenceRule,
      sourceEventUid: eventStatesTable.sourceEventUid,
      startTime: eventStatesTable.startTime,
      startTimeZone: eventStatesTable.startTimeZone,
      title: eventStatesTable.title,
    })
    .from(eventStatesTable)
    .where(and(...syncedConditions))
    .orderBy(asc(eventStatesTable.startTime));

  const syncedEvents = flattenSyncedEvents(syncedRows, sourceMap, start, end);

  const userConditions: SQL[] = [
    inArray(userEventsTable.calendarId, calendarIds),
    eq(userEventsTable.userId, userId),
    gte(userEventsTable.startTime, start),
    lte(userEventsTable.startTime, end),
  ];

  if (filters?.availability && filters.availability.length > 0) {
    userConditions.push(inArray(userEventsTable.availability, filters.availability));
  }
  if (filters && "isAllDay" in filters && typeof filters.isAllDay === "boolean") {
    userConditions.push(eq(userEventsTable.isAllDay, filters.isAllDay));
  }

  const userEvents: UserEventRow[] = await database
    .select({
      calendarId: userEventsTable.calendarId,
      description: userEventsTable.description,
      endTime: userEventsTable.endTime,
      id: userEventsTable.id,
      location: userEventsTable.location,
      startTime: userEventsTable.startTime,
      title: userEventsTable.title,
    })
    .from(userEventsTable)
    .where(and(...userConditions))
    .orderBy(asc(userEventsTable.startTime));

  const allEvents: FlattenedEvent[] = [...syncedEvents, ...userEvents];
  allEvents.sort((left, right) => left.startTime.getTime() - right.startTime.getTime());

  return allEvents.map((event) => {
    const source = sourceMap.get(event.calendarId);
    if (!source) {
      throw new Error(`No source calendar found for event calendar ID: ${event.calendarId}`);
    }
    return {
      calendarId: event.calendarId,
      calendarName: source.name,
      calendarProvider: source.provider,
      calendarUrl: source.url,
      description: event.description,
      endTime: event.endTime.toISOString(),
      id: event.id,
      location: event.location,
      startTime: event.startTime.toISOString(),
      title: event.title,
    };
  });
};

export { getEventsInRange, normalizeEventRange };
