import {
  sourceDestinationMappingsTable,
  eventStatesTable,
  remoteICalSourcesTable,
} from "@keeper.sh/database/schema";
import { eq, gte, inArray, asc } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { SyncableEvent } from "./types";

const getStartOfToday = (): Date => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

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
      inArray(eventStatesTable.sourceId, sourceIds),
    )
    .where(gte(eventStatesTable.startTime, startOfToday))
    .orderBy(asc(eventStatesTable.startTime));

  return results
    .filter((result) => result.sourceEventUid !== null)
    .map((result) => ({
      id: result.id,
      sourceEventUid: result.sourceEventUid!,
      startTime: result.startTime,
      endTime: result.endTime,
      sourceId: result.sourceId,
      sourceName: result.sourceName,
      sourceUrl: result.sourceUrl,
      summary: result.sourceName ?? "Busy",
    }));
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
