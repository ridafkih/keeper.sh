import { eventStatesTable, remoteICalSourcesTable } from "@keeper.sh/database/schema";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { normalizeDateRange, parseDateRangeParams } from "./date-range";
import { database } from "../context";

const EMPTY_SOURCES_COUNT = 0;

interface SourceMetadata {
  name: string;
  url: string;
}

interface EnrichedEvent {
  id: string;
  startTime: Date;
  endTime: Date;
  calendarId: string;
  sourceName: string | undefined;
  sourceUrl: string | undefined;
}

/**
 * Gets events for a user within a date range, enriched with source metadata.
 */
const getEventsInRange = async (userId: string, url: URL): Promise<EnrichedEvent[]> => {
  const { from, to } = parseDateRangeParams(url);
  const { start, end } = normalizeDateRange(from, to);

  const sources = await database
    .select({
      id: remoteICalSourcesTable.id,
      name: remoteICalSourcesTable.name,
      url: remoteICalSourcesTable.url,
    })
    .from(remoteICalSourcesTable)
    .where(eq(remoteICalSourcesTable.userId, userId));

  if (sources.length === EMPTY_SOURCES_COUNT) {
    return [];
  }

  const sourceIds = sources.map((source) => source.id);
  const sourceMap = new Map<string, SourceMetadata>(
    sources.map((source) => [source.id, { name: source.name, url: source.url }]),
  );

  const events = await database
    .select({
      endTime: eventStatesTable.endTime,
      id: eventStatesTable.id,
      sourceId: eventStatesTable.sourceId,
      startTime: eventStatesTable.startTime,
    })
    .from(eventStatesTable)
    .where(
      and(
        inArray(eventStatesTable.sourceId, sourceIds),
        gte(eventStatesTable.startTime, start),
        lte(eventStatesTable.startTime, end),
      ),
    )
    .orderBy(asc(eventStatesTable.startTime));

  return enrichEventsWithSources(events, sourceMap);
};

/**
 * Enriches raw events with source metadata.
 */
const enrichEventsWithSources = (
  events: {
    id: string;
    sourceId: string;
    startTime: Date;
    endTime: Date;
  }[],
  sourceMap: Map<string, SourceMetadata>,
): EnrichedEvent[] =>
  events.map((event) => {
    const source = sourceMap.get(event.sourceId);
    return {
      calendarId: event.sourceId,
      endTime: event.endTime,
      id: event.id,
      sourceName: source?.name,
      sourceUrl: source?.url,
      startTime: event.startTime,
    };
  });

export { getEventsInRange };
