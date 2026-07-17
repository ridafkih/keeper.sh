import {
  calendarsTable,
  eventStatesTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, asc, eq, gte, inArray, isNotNull, or } from "drizzle-orm";
import type { BunSQLClient } from "../database-client";
import type {
  EventAvailability,
  MaterializedSyncableEvent,
  SourceEventType,
  SyncableEvent,
} from "../types";
import { getOAuthSyncWindow } from "../oauth/sync-window";
import type { OAuthSyncWindow } from "../oauth/sync-window";
import { parseStoredRecurrenceForMaterialization } from "./stored-recurrence";
import { materializeRecurrenceEvents } from "./recurrence-materializer";

const EMPTY_SOURCES_COUNT = 0;
const YEARS_UNTIL_FUTURE = 2;

const isEventInDestinationReconciliationWindow = (
  event: Pick<SyncableEvent, "endTime">,
  timeMin: Date,
): boolean => event.endTime >= timeMin;

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

const isEventAvailability = (value: string | null): value is EventAvailability =>
  value === "busy"
  || value === "free"
  || value === "oof"
  || value === "workingElsewhere";

const parseAvailability = (value: string | null): EventAvailability | undefined => {
  if (!isEventAvailability(value)) {
    return;
  }

  return value;
};
const parseSourceEventType = (
  value: string | null,
  availability: string | null,
): SourceEventType => {
  if (value === "focusTime" || value === "outOfOffice" || value === "workingLocation") {
    return value;
  }

  if (availability === "workingElsewhere") {
    return "workingLocation";
  }

  if (availability === "oof") {
    return "outOfOffice";
  }

  return "default";
};

const shouldExcludeSyncEvent = (event: {
  excludeAllDayEvents: boolean;
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
  availability: string | null;
  isAllDay: boolean | null;
  sourceEventType: string | null;
}): boolean => {
  const sourceEventType = parseSourceEventType(event.sourceEventType, event.availability);

  if (sourceEventType === "workingLocation") {
    return true;
  }
  if (event.excludeAllDayEvents && event.isAllDay) {
    return true;
  }
  if (event.excludeFocusTime && sourceEventType === "focusTime") {
    return true;
  }
  if (event.excludeOutOfOffice && sourceEventType === "outOfOffice") {
    return true;
  }

  return false;
};
const TEMPLATE_TOKEN_PATTERN = /\{\{(\w+)\}\}/g;
const DEFAULT_EVENT_NAME = "Busy";
const DEFAULT_EVENT_NAME_TEMPLATE = "{{calendar_name}}";
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

const getMappedSourceCalendarIds = async (
  database: BunSQLClient,
  destinationCalendarId: string,
): Promise<string[]> => {
  const mappings = await database
    .select({ sourceCalendarId: sourceDestinationMappingsTable.sourceCalendarId })
    .from(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId));

  return mappings.map((mapping) => mapping.sourceCalendarId);
};

const getEventsForCalendars = async (
  database: BunSQLClient,
  calendarIds: string[],
  syncWindow: OAuthSyncWindow = getOAuthSyncWindow(YEARS_UNTIL_FUTURE),
): Promise<MaterializedSyncableEvent[]> => {
  if (calendarIds.length === EMPTY_SOURCES_COUNT) {
    return [];
  }

  const results = await database
    .select({
      calendarId: eventStatesTable.calendarId,
      calendarName: calendarsTable.name,
      calendarUrl: calendarsTable.url,
      customEventName: calendarsTable.customEventName,
      excludeAllDayEvents: calendarsTable.excludeAllDayEvents,
      excludeEventDescription: calendarsTable.excludeEventDescription,
      excludeEventLocation: calendarsTable.excludeEventLocation,
      excludeEventName: calendarsTable.excludeEventName,
      excludeFocusTime: calendarsTable.excludeFocusTime,
      excludeOutOfOffice: calendarsTable.excludeOutOfOffice,
      availability: eventStatesTable.availability,
      description: eventStatesTable.description,
      endTime: eventStatesTable.endTime,
      exceptionDates: eventStatesTable.exceptionDates,
      id: eventStatesTable.id,
      isAllDay: eventStatesTable.isAllDay,
      location: eventStatesTable.location,
      recurrenceRule: eventStatesTable.recurrenceRule,
      recurrenceId: eventStatesTable.recurrenceId,
      sourceEventType: eventStatesTable.sourceEventType,
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
          gte(eventStatesTable.endTime, syncWindow.timeMin),
          isNotNull(eventStatesTable.recurrenceRule),
          isNotNull(eventStatesTable.recurrenceId),
        ),
      ),
    )
    .orderBy(asc(eventStatesTable.startTime));

  const syncableEvents: SyncableEvent[] = [];

  for (const result of results) {
    if (result.sourceEventUid === null) {
      continue;
    }
    if (shouldExcludeSyncEvent(result)) {
      continue;
    }

    const recurrence = parseStoredRecurrenceForMaterialization({
      eventId: result.id,
      exceptionDates: result.exceptionDates,
      recurrenceId: result.recurrenceId,
      recurrenceRule: result.recurrenceRule,
    });

    if (
      !isEventInDestinationReconciliationWindow(result, syncWindow.timeMin)
      && !recurrence.recurrenceId
      && !recurrence.recurrenceRule
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
      ...recurrence,
      sourceEventUid: result.sourceEventUid,
      startTime: result.startTime,
      startTimeZone: orAbsent(result.startTimeZone),
      summary,
    });
  }

  return materializeRecurrenceEvents(syncableEvents, {
    end: syncWindow.timeMax,
    start: syncWindow.timeMin,
  }, {
    retainOneOffEventsAfterWindowEnd: true,
  });
};

const getEventsForDestination = async (
  database: BunSQLClient,
  destinationCalendarId: string,
  syncWindow: OAuthSyncWindow = getOAuthSyncWindow(YEARS_UNTIL_FUTURE),
): Promise<MaterializedSyncableEvent[]> => {
  const sourceCalendarIds = await getMappedSourceCalendarIds(database, destinationCalendarId);

  if (sourceCalendarIds.length === EMPTY_SOURCES_COUNT) {
    return [];
  }

  return getEventsForCalendars(database, sourceCalendarIds, syncWindow);
};

export {
  getEventsForCalendars,
  getEventsForDestination,
  getMappedSourceCalendarIds,
  isEventInDestinationReconciliationWindow,
  shouldExcludeSyncEvent,
};
