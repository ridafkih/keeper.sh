import { eventStatesTable, userEventsTable } from "@keeper.sh/database/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  resolveIsAllDayEvent,
  resolveRepresentableTimeRange,
  wallTimeToInstant,
} from "@keeper.sh/calendar";
import { MS_PER_DAY } from "@keeper.sh/constants";
import type { SQL } from "drizzle-orm";
import type {
  KeeperDatabase,
  KeeperEventFilters,
  KeeperEventRangeInput,
  KeeperFreeTimeOptions,
  KeeperFreeTimeResult,
} from "@/types";
import { findFreeSlots, resolveRequestTimeZone } from "@/utils/free-time";
import type { TimeInterval } from "@/utils/free-time";
import {
  buildSyncedRangeCondition,
  buildUserRangeCondition,
  getSourcesForUser,
  isWithinReadWindow,
  normalizeEventRange,
} from "./get-events-in-range";
import { materializeSyncedEvents } from "./event-read-model";
import type { SyncedEventRow } from "./event-read-model";

const EMPTY_RESULT_COUNT = 0;
const NON_BLOCKING_AVAILABILITY = new Set(["free", "workingElsewhere"]);
const ALL_DAY_ZONE_PROJECTION_SLACK_MS = MS_PER_DAY;

interface BusyCandidate {
  availability?: string | null;
  isAllDay?: boolean | null;
  startTime: Date;
  endTime: Date;
}

const isBlocking = (candidate: BusyCandidate, ignoreAllDayEvents: boolean): boolean => {
  if (ignoreAllDayEvents && candidate.isAllDay === true) {
    return false;
  }
  if (typeof candidate.availability !== "string") {
    return true;
  }
  return !NON_BLOCKING_AVAILABILITY.has(candidate.availability);
};

const projectAllDaySpanToZone = (span: TimeInterval, timeZone: string): TimeInterval => ({
  end: wallTimeToInstant(span.end, timeZone),
  start: wallTimeToInstant(span.start, timeZone),
});

const widenForZoneProjection = (range: TimeInterval): TimeInterval => ({
  end: new Date(range.end.getTime() + ALL_DAY_ZONE_PROJECTION_SLACK_MS),
  start: new Date(range.start.getTime() - ALL_DAY_ZONE_PROJECTION_SLACK_MS),
});

const resolveBusySpan = (candidate: BusyCandidate, timeZone: string): TimeInterval => {
  const shape = {
    endTime: candidate.endTime,
    startTime: candidate.startTime,
    ...(typeof candidate.isAllDay === "boolean" && { isAllDay: candidate.isAllDay }),
  };
  const { endTime, startTime } = resolveRepresentableTimeRange(shape);
  const span: TimeInterval = { end: endTime, start: startTime };

  if (!resolveIsAllDayEvent(shape)) {
    return span;
  }
  return projectAllDaySpanToZone(span, timeZone);
};

const toBusyInterval = (
  candidate: BusyCandidate,
  range: TimeInterval,
  timeZone: string,
): TimeInterval => {
  const { end, start } = resolveBusySpan(candidate, timeZone);

  return {
    end: new Date(Math.min(end.getTime(), range.end.getTime())),
    start: new Date(Math.max(start.getTime(), range.start.getTime())),
  };
};

const toBusyIntervals = (
  candidates: BusyCandidate[],
  range: TimeInterval,
  timeZone: string,
  ignoreAllDayEvents: boolean,
): TimeInterval[] => candidates
  .filter((candidate) => isBlocking(candidate, ignoreAllDayEvents))
  .map((candidate) => toBusyInterval(candidate, range, timeZone))
  .filter(({ end, start }) => end.getTime() > start.getTime());

const collectBusyIntervals = async (
  database: KeeperDatabase,
  userId: string,
  range: TimeInterval,
  timeZone: string,
  options: KeeperFreeTimeOptions,
  filters?: KeeperEventFilters,
): Promise<TimeInterval[]> => {
  const { calendarIds, sourceMap } = await getSourcesForUser(database, userId, filters);

  if (calendarIds.length === EMPTY_RESULT_COUNT) {
    return [];
  }

  const syncedConditions: SQL[] = [inArray(eventStatesTable.calendarId, calendarIds)];
  const syncedRangeCondition = buildSyncedRangeCondition(range.start, range.end);
  if (syncedRangeCondition) {
    syncedConditions.push(syncedRangeCondition);
  }

  const syncedRows: SyncedEventRow[] = await database
    .select({
      availability: eventStatesTable.availability,
      calendarId: eventStatesTable.calendarId,
      color: eventStatesTable.color,
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

  const userConditions: SQL[] = [
    inArray(userEventsTable.calendarId, calendarIds),
    eq(userEventsTable.userId, userId),
  ];
  const userRangeCondition = buildUserRangeCondition(range.start, range.end);
  if (userRangeCondition) {
    userConditions.push(userRangeCondition);
  }

  const userEvents = await database
    .select({
      availability: userEventsTable.availability,
      endTime: userEventsTable.endTime,
      isAllDay: userEventsTable.isAllDay,
      startTime: userEventsTable.startTime,
    })
    .from(userEventsTable)
    .where(and(...userConditions))
    .orderBy(asc(userEventsTable.startTime));

  const candidateWindow = widenForZoneProjection(range);
  const candidates: BusyCandidate[] = [
    ...materializeSyncedEvents(syncedRows, sourceMap, candidateWindow.start, candidateWindow.end),
    ...userEvents.filter((event) =>
      isWithinReadWindow(event, candidateWindow.start, candidateWindow.end)),
  ];

  return toBusyIntervals(candidates, range, timeZone, options.ignoreAllDayEvents);
};

const findFreeTime = async (
  database: KeeperDatabase,
  userId: string,
  rangeInput: KeeperEventRangeInput,
  options: KeeperFreeTimeOptions,
  filters?: KeeperEventFilters,
): Promise<KeeperFreeTimeResult> => {
  const { start, end } = normalizeEventRange(rangeInput);
  const range: TimeInterval = { end, start };
  const timeZone = resolveRequestTimeZone(options.timezone);
  const busyIntervals = await collectBusyIntervals(
    database,
    userId,
    range,
    timeZone,
    options,
    filters,
  );

  const slots = findFreeSlots(range, busyIntervals, {
    durationMinutes: options.durationMinutes,
    limit: options.limit,
    timezone: timeZone,
    workingHours: options.workingHours,
  });

  return {
    durationMinutes: options.durationMinutes,
    from: start.toISOString(),
    slots,
    timezone: options.timezone,
    to: end.toISOString(),
  };
};

export {
  findFreeTime,
  isBlocking,
  projectAllDaySpanToZone,
  toBusyInterval,
  toBusyIntervals,
};
