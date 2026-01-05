import {
  sourceDestinationMappingsTable,
  eventStatesTable,
  remoteICalSourcesTable,
} from "@keeper.sh/database/schema";
import { getStartOfToday } from "@keeper.sh/date-utils";
import { and, eq, gte, inArray, asc } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { SyncableEvent } from "../types";

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

    syncableEvents.push({
      id: result.id,
      sourceEventUid: result.sourceEventUid,
      startTime: result.startTime,
      endTime: result.endTime,
      sourceId: result.sourceId,
      sourceName: result.sourceName ?? undefined,
      sourceUrl: result.sourceUrl,
      summary: result.sourceName ?? "Busy",
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
      id: eventStatesTable.id,
      sourceEventUid: eventStatesTable.sourceEventUid,
      startTime: eventStatesTable.startTime,
      endTime: eventStatesTable.endTime,
      sourceId: eventStatesTable.sourceId,
      sourceName: remoteICalSourcesTable.name,
      sourceUrl: remoteICalSourcesTable.url,
    })
    .from(eventStatesTable)
    .innerJoin(
      remoteICalSourcesTable,
      eq(eventStatesTable.sourceId, remoteICalSourcesTable.id),
    )
    .where(
      and(
        inArray(eventStatesTable.sourceId, sourceIds),
        gte(eventStatesTable.startTime, startOfToday),
      ),
    )
    .orderBy(asc(eventStatesTable.startTime));

  return toSyncableEvents(results);
};

export const getEventsForDestination = async (
  database: BunSQLDatabase,
  destinationId: string,
): Promise<SyncableEvent[]> => {
  const mappedSourceIds = await getMappedSourceIds(database, destinationId);

  if (mappedSourceIds.length === 0) {
    return [];
  }

  return fetchEventsForSources(database, mappedSourceIds);
};
