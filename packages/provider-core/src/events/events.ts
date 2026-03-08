import {
  calendarsTable,
  eventStatesTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { getStartOfToday } from "@keeper.sh/date-utils";
import { and, asc, eq, gte, inArray, isNotNull, or } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { extendByRecurrenceRule, type IcsRecurrenceRule } from "ts-ics";
import type { SyncableEvent } from "../types";

const EMPTY_SOURCES_COUNT = 0;
const TEMPLATE_TOKEN_PATTERN = /\{\{(\w+)\}\}/g;
const DEFAULT_EVENT_NAME = "Busy";
const DEFAULT_EVENT_NAME_TEMPLATE = "{{calendar_name}}";
const MIN_RECURRENCE_COUNT = 0;

const RECURRENCE_FREQUENCIES: IcsRecurrenceRule["frequency"][] = [
  "SECONDLY",
  "MINUTELY",
  "HOURLY",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "YEARLY",
];
const WEEK_DAYS: NonNullable<IcsRecurrenceRule["workweekStart"]>[] = [
  "SU",
  "MO",
  "TU",
  "WE",
  "TH",
  "FR",
  "SA",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const parseJson = (value: string | null): unknown => {
  if (value === null) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const parseWeekDay = (
  value: unknown,
): NonNullable<IcsRecurrenceRule["workweekStart"]> | null => {
  if (typeof value !== "string") {
    return null;
  }

  for (const weekDay of WEEK_DAYS) {
    if (weekDay === value) {
      return weekDay;
    }
  }

  return null;
};

const parseRecurrenceFrequency = (value: unknown): IcsRecurrenceRule["frequency"] | null => {
  if (typeof value !== "string") {
    return null;
  }

  for (const frequency of RECURRENCE_FREQUENCIES) {
    if (frequency === value) {
      return frequency;
    }
  }

  return null;
};

const parseNumberArray = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  if (value.some((entry) => typeof entry !== "number")) {
    return undefined;
  }

  return value;
};

const parseRecurrenceByDay = (value: unknown): IcsRecurrenceRule["byDay"] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const byDay: NonNullable<IcsRecurrenceRule["byDay"]> = [];

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const parsedDay = parseWeekDay(entry.day);
    if (!parsedDay) {
      continue;
    }

    if (entry.occurrence !== undefined && typeof entry.occurrence !== "number") {
      continue;
    }

    if (typeof entry.occurrence === "number") {
      byDay.push({ day: parsedDay, occurrence: entry.occurrence });
      continue;
    }

    byDay.push({ day: parsedDay });
  }

  return byDay.length > MIN_RECURRENCE_COUNT ? byDay : undefined;
};

const parseUntilDate = (value: unknown): IcsRecurrenceRule["until"] | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const { date } = value;
  if (date instanceof Date) {
    return Number.isNaN(date.getTime()) ? undefined : { date };
  }

  if (typeof date !== "string") {
    return undefined;
  }

  const parsedDate = new Date(date);
  return Number.isNaN(parsedDate.getTime()) ? undefined : { date: parsedDate };
};

const parseExceptionDates = (exceptionDates: string | null): Date[] | undefined => {
  const parsedExceptionDates = parseJson(exceptionDates);
  if (!Array.isArray(parsedExceptionDates)) {
    return undefined;
  }

  const dates = parsedExceptionDates.flatMap((exceptionDate) => {
    if (!isRecord(exceptionDate)) {
      return [];
    }

    const { date } = exceptionDate;
    if (!(date instanceof Date) && typeof date !== "string") {
      return [];
    }

    const parsedDate = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(parsedDate.getTime())) {
      return [];
    }

    return [parsedDate];
  });

  return dates.length > MIN_RECURRENCE_COUNT ? dates : undefined;
};

const parseRecurrenceRule = (recurrenceRule: string | null): IcsRecurrenceRule | null => {
  const parsedRecurrenceRule = parseJson(recurrenceRule);
  if (!isRecord(parsedRecurrenceRule)) {
    return null;
  }

  const frequency = parseRecurrenceFrequency(parsedRecurrenceRule.frequency);
  if (!frequency) {
    return null;
  }

  const normalizedRule: IcsRecurrenceRule = { frequency };

  if (typeof parsedRecurrenceRule.count === "number") {
    normalizedRule.count = parsedRecurrenceRule.count;
  }
  if (typeof parsedRecurrenceRule.interval === "number") {
    normalizedRule.interval = parsedRecurrenceRule.interval;
  }

  const until = parseUntilDate(parsedRecurrenceRule.until);
  if (until) {
    normalizedRule.until = until;
  }

  const bySecond = parseNumberArray(parsedRecurrenceRule.bySecond);
  if (bySecond) {
    normalizedRule.bySecond = bySecond;
  }

  const byMinute = parseNumberArray(parsedRecurrenceRule.byMinute);
  if (byMinute) {
    normalizedRule.byMinute = byMinute;
  }

  const byHour = parseNumberArray(parsedRecurrenceRule.byHour);
  if (byHour) {
    normalizedRule.byHour = byHour;
  }

  const byDay = parseRecurrenceByDay(parsedRecurrenceRule.byDay);
  if (byDay) {
    normalizedRule.byDay = byDay;
  }

  const byMonthday = parseNumberArray(parsedRecurrenceRule.byMonthday);
  if (byMonthday) {
    normalizedRule.byMonthday = byMonthday;
  }

  const byYearday = parseNumberArray(parsedRecurrenceRule.byYearday);
  if (byYearday) {
    normalizedRule.byYearday = byYearday;
  }

  const byWeekNo = parseNumberArray(parsedRecurrenceRule.byWeekNo);
  if (byWeekNo) {
    normalizedRule.byWeekNo = byWeekNo;
  }

  const byMonth = parseNumberArray(parsedRecurrenceRule.byMonth);
  if (byMonth) {
    normalizedRule.byMonth = byMonth;
  }

  const bySetPos = parseNumberArray(parsedRecurrenceRule.bySetPos);
  if (bySetPos) {
    normalizedRule.bySetPos = bySetPos;
  }

  const workweekStart = parseWeekDay(parsedRecurrenceRule.workweekStart);
  if (workweekStart) {
    normalizedRule.workweekStart = workweekStart;
  }

  return normalizedRule;
};

const hasActiveFutureOccurrence = (
  startTime: Date,
  recurrenceRule: IcsRecurrenceRule | null,
  exceptionDates: Date[] | undefined,
  startOfToday: Date,
): boolean => {
  if (!recurrenceRule) {
    return false;
  }

  const dates = extendByRecurrenceRule(recurrenceRule, {
    exceptions: exceptionDates,
    start: startTime,
  });

  return dates.some((date) => date >= startOfToday);
};

const getMappedSourceCalendarIds = async (
  database: BunSQLDatabase,
  destinationCalendarId: string,
): Promise<string[]> => {
  const mappings = await database
    .select({ sourceCalendarId: sourceDestinationMappingsTable.sourceCalendarId })
    .from(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId));

  return mappings.map((mapping) => mapping.sourceCalendarId);
};

const fetchEventsForCalendars = async (
  database: BunSQLDatabase,
  calendarIds: string[],
): Promise<SyncableEvent[]> => {
  if (calendarIds.length === EMPTY_SOURCES_COUNT) {
    return [];
  }

  const startOfToday = getStartOfToday();

  const results = await database
    .select({
      calendarId: eventStatesTable.calendarId,
      calendarName: calendarsTable.name,
      calendarUrl: calendarsTable.url,
      customEventName: calendarsTable.customEventName,
      excludeEventDescription: calendarsTable.excludeEventDescription,
      excludeEventLocation: calendarsTable.excludeEventLocation,
      excludeEventName: calendarsTable.excludeEventName,
      description: eventStatesTable.description,
      endTime: eventStatesTable.endTime,
      exceptionDates: eventStatesTable.exceptionDates,
      id: eventStatesTable.id,
      location: eventStatesTable.location,
      recurrenceRule: eventStatesTable.recurrenceRule,
      sourceEventUid: eventStatesTable.sourceEventUid,
      startTime: eventStatesTable.startTime,
      startTimeZone: eventStatesTable.startTimeZone,
      title: eventStatesTable.title,
    })
    .from(eventStatesTable)
    .innerJoin(calendarsTable, eq(eventStatesTable.calendarId, calendarsTable.id))
    .where(
      and(
        inArray(eventStatesTable.calendarId, calendarIds),
        or(
          gte(eventStatesTable.startTime, startOfToday),
          isNotNull(eventStatesTable.recurrenceRule),
        ),
      ),
    )
    .orderBy(asc(eventStatesTable.startTime));

  const syncableEvents: SyncableEvent[] = [];

  for (const result of results) {
    if (result.sourceEventUid === null) {
      continue;
    }

    const parsedRecurrenceRule = parseRecurrenceRule(result.recurrenceRule);
    const parsedExceptionDates = parseExceptionDates(result.exceptionDates);

    if (
      result.startTime < startOfToday
      && !hasActiveFutureOccurrence(
        result.startTime,
        parsedRecurrenceRule,
        parsedExceptionDates,
        startOfToday,
      )
    ) {
      continue;
    }

    const eventName = result.title ?? DEFAULT_EVENT_NAME;
    const calendarName = result.calendarName;
    const template = result.customEventName || DEFAULT_EVENT_NAME_TEMPLATE;

    const summary = result.excludeEventName
      ? resolveEventNameTemplate(template, {
        calendar_name: calendarName,
        event_name: eventName,
      })
      : eventName;

    syncableEvents.push({
      calendarId: result.calendarId,
      calendarName: result.calendarName,
      calendarUrl: result.calendarUrl,
      description: result.excludeEventDescription ? undefined : result.description ?? undefined,
      endTime: result.endTime,
      id: result.id,
      location: result.excludeEventLocation ? undefined : result.location ?? undefined,
      exceptionDates: parsedExceptionDates,
      recurrenceRule: parsedRecurrenceRule ?? undefined,
      sourceEventUid: result.sourceEventUid,
      startTime: result.startTime,
      startTimeZone: result.startTimeZone ?? undefined,
      summary,
    });
  }

  return syncableEvents;
};

const resolveEventNameTemplate = (
  template: string,
  variables: Record<string, string>,
): string => {
  const resolved = template.replace(
    TEMPLATE_TOKEN_PATTERN,
    (token, variableName) => variables[variableName] ?? token,
  ).trim();

  return resolved || variables.calendar_name || DEFAULT_EVENT_NAME;
};

const getEventsForDestination = async (
  database: BunSQLDatabase,
  destinationCalendarId: string,
): Promise<SyncableEvent[]> => {
  const sourceCalendarIds = await getMappedSourceCalendarIds(database, destinationCalendarId);

  if (sourceCalendarIds.length === EMPTY_SOURCES_COUNT) {
    return [];
  }

  return fetchEventsForCalendars(database, sourceCalendarIds);
};

export { getEventsForDestination };
