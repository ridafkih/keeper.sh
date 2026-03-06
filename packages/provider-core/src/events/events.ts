import {
  calendarsTable,
  eventStatesTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { getStartOfToday } from "@keeper.sh/date-utils";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { SyncableEvent } from "../types";

const EMPTY_SOURCES_COUNT = 0;

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
      calendarType: calendarsTable.calendarType,
      calendarUrl: calendarsTable.url,
      description: eventStatesTable.description,
      endTime: eventStatesTable.endTime,
      id: eventStatesTable.id,
      location: eventStatesTable.location,
      sourceEventUid: eventStatesTable.sourceEventUid,
      startTime: eventStatesTable.startTime,
      title: eventStatesTable.title,
    })
    .from(eventStatesTable)
    .innerJoin(calendarsTable, eq(eventStatesTable.calendarId, calendarsTable.id))
    .where(
      and(
        inArray(eventStatesTable.calendarId, calendarIds),
        gte(eventStatesTable.startTime, startOfToday),
      ),
    )
    .orderBy(asc(eventStatesTable.startTime));

  const syncableEvents: SyncableEvent[] = [];

  for (const result of results) {
    if (result.sourceEventUid === null) {
      continue;
    }

    syncableEvents.push({
      calendarId: result.calendarId,
      calendarName: result.calendarName,
      calendarUrl: result.calendarUrl ?? result.calendarType,
      description: result.description ?? undefined,
      endTime: result.endTime,
      id: result.id,
      sourceEventUid: result.sourceEventUid,
      startTime: result.startTime,
      summary: result.title ?? result.calendarName ?? "Busy",
    });
  }

  return syncableEvents;
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
