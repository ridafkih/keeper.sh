import {
  calendarsTable,
  eventStatesTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, asc, eq, gte, inArray, isNotNull, or } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { EventAvailability, SyncableEvent } from "../types";
import { getOAuthSyncWindowStart } from "../oauth/sync-window";
import {
  hasActiveFutureOccurrence,
  parseExceptionDatesFromJson,
  parseRecurrenceRuleFromJson,
} from "./recurrence";

const EMPTY_SOURCES_COUNT = 0;

const orAbsent = <TValue>(value: TValue | null): TValue | undefined => {
  if (value === null) {
    return;
  }
  return value;
};

const excludeOrAbsent = <TValue>(exclude: boolean, value: TValue | null): TValue | undefined => {
  if (exclude) {
    return;
  }
  return orAbsent(value);
};
const orAbsentBoolean = (value: boolean | null): boolean | undefined => {
  if (value === null) {
    return;
  }
  return value;
};
const parseAvailability = (value: string | null): EventAvailability | undefined => {
  if (value === "busy" || value === "free" || value === "oof" || value === "workingElsewhere") {
    return value;
  }

  return;
};
const TEMPLATE_TOKEN_PATTERN = /\{\{(\w+)\}\}/g;
const DEFAULT_EVENT_NAME = "Busy";
const DEFAULT_EVENT_NAME_TEMPLATE = "{{calendar_name}}";

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

  const syncWindowStart = getOAuthSyncWindowStart();

  const results = await database
    .select({
      calendarId: eventStatesTable.calendarId,
      calendarName: calendarsTable.name,
      calendarUrl: calendarsTable.url,
      customEventName: calendarsTable.customEventName,
      excludeEventDescription: calendarsTable.excludeEventDescription,
      excludeEventLocation: calendarsTable.excludeEventLocation,
      excludeEventName: calendarsTable.excludeEventName,
      availability: eventStatesTable.availability,
      description: eventStatesTable.description,
      endTime: eventStatesTable.endTime,
      exceptionDates: eventStatesTable.exceptionDates,
      id: eventStatesTable.id,
      isAllDay: eventStatesTable.isAllDay,
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
          gte(eventStatesTable.startTime, syncWindowStart),
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

    const parsedRecurrenceRule = parseRecurrenceRuleFromJson(result.recurrenceRule);
    const parsedExceptionDates = parseExceptionDatesFromJson(result.exceptionDates);

    if (
      result.startTime < syncWindowStart
      && !hasActiveFutureOccurrence(
        result.startTime,
        parsedRecurrenceRule,
        parsedExceptionDates,
        syncWindowStart,
      )
    ) {
      continue;
    }

    const eventName = result.title ?? DEFAULT_EVENT_NAME;
    const {calendarName} = result;
    const template = result.customEventName || DEFAULT_EVENT_NAME_TEMPLATE;

    let summary = eventName;
    if (result.excludeEventName) {
      summary = resolveEventNameTemplate(template, {
        calendar_name: calendarName,
        event_name: eventName,
      });
    }

    syncableEvents.push({
      calendarId: result.calendarId,
      calendarName: result.calendarName,
      calendarUrl: result.calendarUrl,
      availability: parseAvailability(result.availability),
      description: excludeOrAbsent(result.excludeEventDescription, result.description),
      endTime: result.endTime,
      id: result.id,
      isAllDay: orAbsentBoolean(result.isAllDay),
      location: excludeOrAbsent(result.excludeEventLocation, result.location),
      exceptionDates: parsedExceptionDates,
      recurrenceRule: orAbsent(parsedRecurrenceRule),
      sourceEventUid: result.sourceEventUid,
      startTime: result.startTime,
      startTimeZone: orAbsent(result.startTimeZone),
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
