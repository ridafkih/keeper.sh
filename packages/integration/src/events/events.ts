import {
  eventStatesTable,
  remoteICalSourcesTable,
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

interface EventQueryResult {
  id: string;
  sourceEventUid: string | null;
  startTime: Date;
  endTime: Date;
  sourceId: string;
  sourceName: string | null;
  sourceUrl: string;
}

const toSyncableEvents = (results: EventQueryResult[]): SyncableEvent[] => {
  const syncableEvents: SyncableEvent[] = [];

  for (const result of results) {
    if (result.sourceEventUid === null) {
      continue;
    }

    const { sourceName = null } = result ?? {};
    const summary = sourceName ?? "Busy";

    syncableEvents.push({
      endTime: result.endTime,
      id: result.id,
      sourceEventUid: result.sourceEventUid,
      sourceId: result.sourceId,
      sourceName,
      sourceUrl: result.sourceUrl,
      startTime: result.startTime,
      summary,
    });
  }

  return syncableEvents;
};

const fetchEventsForSources = async (
  database: BunSQLDatabase,
  sourceIds: string[],
): Promise<SyncableEvent[]> => {
  const startOfToday = getStartOfToday();

  const results = await database
    .select({
      endTime: eventStatesTable.endTime,
      id: eventStatesTable.id,
      sourceEventUid: eventStatesTable.sourceEventUid,
      sourceId: eventStatesTable.sourceId,
      sourceName: remoteICalSourcesTable.name,
      sourceUrl: remoteICalSourcesTable.url,
      startTime: eventStatesTable.startTime,
    })
    .from(eventStatesTable)
    .innerJoin(remoteICalSourcesTable, eq(eventStatesTable.sourceId, remoteICalSourcesTable.id))
    .where(
      and(
        inArray(eventStatesTable.sourceId, sourceIds),
        gte(eventStatesTable.startTime, startOfToday),
      ),
    )
    .orderBy(asc(eventStatesTable.startTime));

  return toSyncableEvents(results);
};

const getEventsForDestination = async (
  database: BunSQLDatabase,
  destinationId: string,
): Promise<SyncableEvent[]> => {
  const mappedSourceIds = await getMappedSourceIds(database, destinationId);

  if (mappedSourceIds.length === EMPTY_SOURCES_COUNT) {
    return [];
  }

  return fetchEventsForSources(database, mappedSourceIds);
};

export { getEventsForDestination };
