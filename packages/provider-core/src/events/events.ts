import {
  calendarSourcesTable,
  eventStatesTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { getStartOfToday } from "@keeper.sh/date-utils";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { SyncableEvent } from "../types";

const EMPTY_SOURCES_COUNT = 0;

const getMappedSourceIds = async (
  database: BunSQLDatabase,
  destinationId: string,
): Promise<string[]> => {
  const mappings = await database
    .select({ sourceId: sourceDestinationMappingsTable.sourceId })
    .from(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.destinationId, destinationId));

  return mappings.map((mapping) => mapping.sourceId);
};

const fetchEventsForSources = async (
  database: BunSQLDatabase,
  sourceIds: string[],
): Promise<SyncableEvent[]> => {
  if (sourceIds.length === EMPTY_SOURCES_COUNT) {
    return [];
  }

  const startOfToday = getStartOfToday();

  const results = await database
    .select({
      endTime: eventStatesTable.endTime,
      id: eventStatesTable.id,
      sourceEventUid: eventStatesTable.sourceEventUid,
      sourceId: eventStatesTable.sourceId,
      sourceName: calendarSourcesTable.name,
      sourceType: calendarSourcesTable.sourceType,
      sourceUrl: calendarSourcesTable.url,
      startTime: eventStatesTable.startTime,
    })
    .from(eventStatesTable)
    .innerJoin(calendarSourcesTable, eq(eventStatesTable.sourceId, calendarSourcesTable.id))
    .where(
      and(
        inArray(eventStatesTable.sourceId, sourceIds),
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
      endTime: result.endTime,
      id: result.id,
      sourceEventUid: result.sourceEventUid,
      sourceId: result.sourceId,
      sourceName: result.sourceName,
      sourceUrl: result.sourceUrl ?? result.sourceType,
      startTime: result.startTime,
      summary: result.sourceName ?? "Busy",
    });
  }

  return syncableEvents;
};

const getEventsForDestination = async (
  database: BunSQLDatabase,
  destinationId: string,
): Promise<SyncableEvent[]> => {
  const sourceIds = await getMappedSourceIds(database, destinationId);

  if (sourceIds.length === EMPTY_SOURCES_COUNT) {
    return [];
  }

  return fetchEventsForSources(database, sourceIds);
};

export { getEventsForDestination };
