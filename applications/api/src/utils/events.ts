import { calendarAccountsTable, calendarsTable, eventStatesTable } from "@keeper.sh/database/schema";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { normalizeDateRange, parseDateRangeParams } from "./date-range";
import { database } from "../context";

const EMPTY_SOURCES_COUNT = 0;

interface SourceMetadata {
  name: string;
  provider: string | null;
  url: string | null;
}

interface EnrichedEvent {
  id: string;
  startTime: Date;
  endTime: Date;
  calendarId: string;
  calendarName: string | undefined;
  calendarProvider: string | null | undefined;
  calendarUrl: string | null | undefined;
}

/**
 * Gets events for a user within a date range, enriched with source metadata.
 */
const getEventsInRange = async (userId: string, url: URL): Promise<EnrichedEvent[]> => {
  const { from, to } = parseDateRangeParams(url);
  const { start, end } = normalizeDateRange(from, to);

  const sources = await database
    .select({
      id: calendarsTable.id,
      name: calendarsTable.name,
      provider: calendarAccountsTable.provider,
      url: calendarsTable.url,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(
      and(
        eq(calendarsTable.userId, userId),
        inArray(calendarsTable.role, ["source", "both"]),
      ),
    );

  if (sources.length === EMPTY_SOURCES_COUNT) {
    return [];
  }

  const calendarIds = sources.map((source) => source.id);
  const sourceMap = new Map<string, SourceMetadata>(
    sources.map((source) => [source.id, { name: source.name, provider: source.provider, url: source.url }]),
  );

  const events = await database
    .select({
      calendarId: eventStatesTable.calendarId,
      endTime: eventStatesTable.endTime,
      id: eventStatesTable.id,
      startTime: eventStatesTable.startTime,
    })
    .from(eventStatesTable)
    .where(
      and(
        inArray(eventStatesTable.calendarId, calendarIds),
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
    calendarId: string;
    startTime: Date;
    endTime: Date;
  }[],
  sourceMap: Map<string, SourceMetadata>,
): EnrichedEvent[] =>
  events.map((event) => {
    const source = sourceMap.get(event.calendarId);
    return {
      calendarId: event.calendarId,
      endTime: event.endTime,
      id: event.id,
      calendarName: source?.name,
      calendarProvider: source?.provider,
      calendarUrl: source?.url,
      startTime: event.startTime,
    };
  });

export { getEventsInRange };
