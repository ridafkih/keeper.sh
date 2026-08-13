import { eventStatesTable, userEventsTable } from "@keeper.sh/database/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { resolveRepresentableTimeRange } from "@keeper.sh/calendar";
import type { SQL } from "drizzle-orm";
import type {
  KeeperDatabase,
  KeeperEventFilters,
  KeeperEventRangeInput,
  KeeperFreeTimeOptions,
  KeeperFreeTimeResult,
} from "@/types";
import { findFreeSlots } from "@/utils/free-time";
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

// Shaped first: interval merging drops non-positive spans, so a degenerate event would read as free.
const toBusyInterval = (candidate: BusyCandidate, range: TimeInterval): TimeInterval => {
  const { endTime, startTime } = resolveRepresentableTimeRange({
    endTime: candidate.endTime,
    startTime: candidate.startTime,
    ...(typeof candidate.isAllDay === "boolean" && { isAllDay: candidate.isAllDay }),
  });

  return {
    end: new Date(Math.min(endTime.getTime(), range.end.getTime())),
    start: new Date(Math.max(startTime.getTime(), range.start.getTime())),
  };
};

const collectBusyIntervals = async (
  database: KeeperDatabase,
  userId: string,
  range: TimeInterval,
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

  const candidates: BusyCandidate[] = [
    ...materializeSyncedEvents(syncedRows, sourceMap, range.start, range.end),
    ...userEvents.filter((event) => isWithinReadWindow(event, range.start, range.end)),
  ];

  return candidates
    .filter((candidate) => isBlocking(candidate, options.ignoreAllDayEvents))
    .map((candidate) => toBusyInterval(candidate, range));
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
  const busyIntervals = await collectBusyIntervals(database, userId, range, options, filters);

  const slots = findFreeSlots(range, busyIntervals, {
    durationMinutes: options.durationMinutes,
    limit: options.limit,
    timezone: options.timezone,
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

export { findFreeTime, isBlocking, toBusyInterval };
