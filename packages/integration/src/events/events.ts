import {
  eventStatesTable,
  oauthCalendarSourcesTable,
  oauthEventStatesTable,
  oauthSourceDestinationMappingsTable,
  remoteICalSourcesTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { getStartOfToday } from "@keeper.sh/date-utils";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { SyncableEvent } from "../types";

const EMPTY_SOURCES_COUNT = 0;

interface MappedSourceIds {
  icalSourceIds: string[];
  oauthSourceIds: string[];
}

const getMappedSourceIds = async (
  database: BunSQLDatabase,
  destinationId: string,
): Promise<MappedSourceIds> => {
  const icalMappings = await database
    .select({ sourceId: sourceDestinationMappingsTable.sourceId })
    .from(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.destinationId, destinationId));

  const oauthMappings = await database
    .select({ oauthSourceId: oauthSourceDestinationMappingsTable.oauthSourceId })
    .from(oauthSourceDestinationMappingsTable)
    .where(eq(oauthSourceDestinationMappingsTable.destinationId, destinationId));

  return {
    icalSourceIds: icalMappings.map((mapping) => mapping.sourceId),
    oauthSourceIds: oauthMappings.map((mapping) => mapping.oauthSourceId),
  };
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

const fetchICalEventsForSources = async (
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

const fetchOAuthEventsForSources = async (
  database: BunSQLDatabase,
  oauthSourceIds: string[],
): Promise<SyncableEvent[]> => {
  if (oauthSourceIds.length === EMPTY_SOURCES_COUNT) {
    return [];
  }

  const startOfToday = getStartOfToday();

  const results = await database
    .select({
      endTime: oauthEventStatesTable.endTime,
      id: oauthEventStatesTable.id,
      sourceEventUid: oauthEventStatesTable.sourceEventUid,
      sourceId: oauthEventStatesTable.oauthSourceId,
      sourceName: oauthCalendarSourcesTable.name,
      startTime: oauthEventStatesTable.startTime,
    })
    .from(oauthEventStatesTable)
    .innerJoin(
      oauthCalendarSourcesTable,
      eq(oauthEventStatesTable.oauthSourceId, oauthCalendarSourcesTable.id),
    )
    .where(
      and(
        inArray(oauthEventStatesTable.oauthSourceId, oauthSourceIds),
        gte(oauthEventStatesTable.startTime, startOfToday),
      ),
    )
    .orderBy(asc(oauthEventStatesTable.startTime));

  return results
    .filter((row): row is typeof row & { sourceEventUid: string } => row.sourceEventUid !== null)
    .map((row) => ({
      endTime: row.endTime,
      id: row.id,
      sourceEventUid: row.sourceEventUid,
      sourceId: row.sourceId,
      sourceName: row.sourceName,
      sourceUrl: "oauth-calendar",
      startTime: row.startTime,
      summary: row.sourceName ?? "Busy",
    }));
};

const getEventsForDestination = async (
  database: BunSQLDatabase,
  destinationId: string,
): Promise<SyncableEvent[]> => {
  const { icalSourceIds, oauthSourceIds } = await getMappedSourceIds(database, destinationId);

  const hasNoSources =
    icalSourceIds.length === EMPTY_SOURCES_COUNT &&
    oauthSourceIds.length === EMPTY_SOURCES_COUNT;

  if (hasNoSources) {
    return [];
  }

  const [icalEvents, oauthEvents] = await Promise.all([
    fetchICalEventsForSources(database, icalSourceIds),
    fetchOAuthEventsForSources(database, oauthSourceIds),
  ]);

  const allEvents = [...icalEvents, ...oauthEvents];
  allEvents.sort((eventA, eventB) => eventA.startTime.getTime() - eventB.startTime.getTime());

  return allEvents;
};

export { getEventsForDestination };
