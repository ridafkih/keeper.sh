import { remoteICalSourcesTable, eventStatesTable } from "@keeper.sh/database/schema";
import { eq, and, inArray, gte, lte, asc } from "drizzle-orm";
import { parseDateRangeParams, normalizeDateRange } from "./date-range";
import { database } from "../context";

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
export const getEventsInRange = async (userId: string, url: URL): Promise<EnrichedEvent[]> => {
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

  if (sources.length === 0) {
    return [];
  }

  const sourceIds = sources.map((source) => source.id);
  const sourceMap = new Map<string, SourceMetadata>(
    sources.map((source) => [source.id, { name: source.name, url: source.url }]),
  );

  const events = await database
    .select({
      id: eventStatesTable.id,
      sourceId: eventStatesTable.sourceId,
      startTime: eventStatesTable.startTime,
      endTime: eventStatesTable.endTime,
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
  events: Array<{
    id: string;
    sourceId: string;
    startTime: Date;
    endTime: Date;
  }>,
  sourceMap: Map<string, SourceMetadata>,
): EnrichedEvent[] => {
  return events.map((event) => {
    const source = sourceMap.get(event.sourceId);
    return {
      id: event.id,
      startTime: event.startTime,
      endTime: event.endTime,
      calendarId: event.sourceId,
      sourceName: source?.name,
      sourceUrl: source?.url,
    };
  });
};
