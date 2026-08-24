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
  overlapsRepresentableTimeWindow,
  REPRESENTABLE_RANGE_SLACK_MS,
} from "@keeper.sh/calendar";
import type { KeeperDatabase, KeeperEvent, KeeperEventFilters, KeeperEventRangeInput } from "@/types";
import { projectSyncedEvents, toKeeperEvent, toUserProjection } from "./event-read-model";
import type {
  KeeperEventProjection,
  SourceInfo,
  SyncedEventRow,
  UserEventRow,
} from "./event-read-model";

const EMPTY_RESULT_COUNT = 0;

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

const flattenSyncedEvents = (
  rows: SyncedEventRow[],
  sourceMap: Map<string, SourceInfo>,
  windowStart: Date,
  windowEnd: Date,
  filters?: KeeperEventFilters,
): KeeperEventProjection[] => projectSyncedEvents(
  rows,
  sourceMap,
  windowStart,
  windowEnd,
  filters,
);

// Scan wider than the window — the clause sees only stored columns — and let isWithinReadWindow decide.
const toScanBounds = (start: Date, end: Date): { scanEnd: Date; scanStart: Date } => ({
  scanEnd: new Date(end.getTime() + REPRESENTABLE_RANGE_SLACK_MS),
  scanStart: new Date(start.getTime() - REPRESENTABLE_RANGE_SLACK_MS),
});

/**
 * Build the WHERE clause for fetching synced rows that may contribute events
 * to [start, end]: overlapping one-offs, recurring masters whose first
 * occurrence is at-or-before the window end, and detached overrides that either
 * overlap the range at their moved time or originally occupied a slot in it.
 */
const buildSyncedRangeCondition = (start: Date, end: Date): SQL | undefined => {
  const { scanEnd, scanStart } = toScanBounds(start, end);

  return or(
    and(
      isNull(eventStatesTable.recurrenceRule),
      isNull(eventStatesTable.recurrenceId),
      or(
        gte(eventStatesTable.endTime, scanStart),
        gte(eventStatesTable.startTime, scanStart),
      ),
      lte(eventStatesTable.startTime, scanEnd),
    ),
    and(
      isNotNull(eventStatesTable.recurrenceRule),
      lte(eventStatesTable.startTime, scanEnd),
    ),
    isNotNull(eventStatesTable.recurrenceId),
  );
};

const buildUserRangeCondition = (start: Date, end: Date): SQL | undefined => {
  const { scanEnd, scanStart } = toScanBounds(start, end);

  return and(
    or(
      gte(userEventsTable.endTime, scanStart),
      gte(userEventsTable.startTime, scanStart),
    ),
    lte(userEventsTable.startTime, scanEnd),
  );
};

// Read windows are inclusive of their end; the shared predicate is half-open.
const INCLUSIVE_WINDOW_END_MS = 1;

const isWithinReadWindow = (
  row: { endTime: Date; isAllDay?: boolean | null; startTime: Date },
  start: Date,
  end: Date,
): boolean => overlapsRepresentableTimeWindow(
  {
    endTime: row.endTime,
    startTime: row.startTime,
    ...(typeof row.isAllDay === "boolean" && { isAllDay: row.isAllDay }),
  },
  start,
  new Date(end.getTime() + INCLUSIVE_WINDOW_END_MS),
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

  const syncedRows: SyncedEventRow[] = await database
    .select({
      availability: eventStatesTable.availability,
      calendarId: eventStatesTable.calendarId,
      description: eventStatesTable.description,
      endTime: eventStatesTable.endTime,
      exceptionDates: eventStatesTable.exceptionDates,
      id: eventStatesTable.id,
      isAllDay: eventStatesTable.isAllDay,
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

  const syncedEvents = flattenSyncedEvents(syncedRows, sourceMap, start, end, filters);

  const userConditions: SQL[] = [
    inArray(userEventsTable.calendarId, calendarIds),
    eq(userEventsTable.userId, userId),
  ];
  const userRangeCondition = buildUserRangeCondition(start, end);
  if (userRangeCondition) {
    userConditions.push(userRangeCondition);
  }

  if (filters?.availability && filters.availability.length > 0) {
    userConditions.push(inArray(userEventsTable.availability, filters.availability));
  }
  if (filters && "isAllDay" in filters && typeof filters.isAllDay === "boolean") {
    userConditions.push(eq(userEventsTable.isAllDay, filters.isAllDay));
  }

  const userEventRows: UserEventRow[] = await database
    .select({
      calendarId: userEventsTable.calendarId,
      description: userEventsTable.description,
      endTime: userEventsTable.endTime,
      id: userEventsTable.id,
      isAllDay: userEventsTable.isAllDay,
      location: userEventsTable.location,
      startTime: userEventsTable.startTime,
      title: userEventsTable.title,
    })
    .from(userEventsTable)
    .where(and(...userConditions))
    .orderBy(asc(userEventsTable.startTime));

  const allEvents: KeeperEventProjection[] = [
    ...syncedEvents,
    ...userEventRows
      .filter((event) => isWithinReadWindow(event, start, end))
      .map((event) => toUserProjection(event)),
  ];
  allEvents.sort((left, right) => left.startTime.getTime() - right.startTime.getTime());

  return allEvents.map((event) => {
    const source = sourceMap.get(event.calendarId);
    if (!source) {
      throw new Error(`No source calendar found for event calendar ID: ${event.calendarId}`);
    }
    return toKeeperEvent(event, source);
  });
};

export {
  buildSyncedRangeCondition,
  buildUserRangeCondition,
  flattenSyncedEvents,
  getEventsInRange,
  getSourcesForUser,
  isWithinReadWindow,
  normalizeEventRange,
};
