import {
  calendarsTable,
  eventMappingsTable,
  eventStatesTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, asc, countDistinct, eq, gte, sql } from "drizzle-orm";
import type { KeeperDatabase } from "@/types";

interface CopiedEvent {
  id: string;
  title: string | null;
  startTime: string;
  sourceCalendarId: string | null;
  destinationCalendarId: string;
}

interface CopiedEvents {
  count: number;
  upcoming: CopiedEvent[];
}

const sourceEventIdentity = sql`coalesce(${eventMappingsTable.syncEventId}, ${eventMappingsTable.eventStateId}::text)`;

const throughCurrentMapping = and(
  eq(sourceDestinationMappingsTable.sourceCalendarId, eventMappingsTable.sourceCalendarId),
  eq(sourceDestinationMappingsTable.destinationCalendarId, eventMappingsTable.calendarId),
);

const countCopiedEvents = async (database: KeeperDatabase, userId: string): Promise<number> => {
  const [row] = await database
    .select({ value: countDistinct(sourceEventIdentity) })
    .from(eventMappingsTable)
    .innerJoin(sourceDestinationMappingsTable, throughCurrentMapping)
    .innerJoin(calendarsTable, eq(eventMappingsTable.calendarId, calendarsTable.id))
    .where(eq(calendarsTable.userId, userId));
  return row?.value ?? 0;
};

const listUpcomingCopiedEvents = async (
  database: KeeperDatabase,
  userId: string,
  limit: number,
  now: Date,
): Promise<CopiedEvent[]> => {
  const rows = await database
    .selectDistinctOn([eventMappingsTable.startTime, sourceEventIdentity], {
      destinationCalendarId: eventMappingsTable.calendarId,
      id: eventMappingsTable.id,
      sourceCalendarId: eventMappingsTable.sourceCalendarId,
      startTime: eventMappingsTable.startTime,
      title: eventStatesTable.title,
    })
    .from(eventMappingsTable)
    .innerJoin(sourceDestinationMappingsTable, throughCurrentMapping)
    .innerJoin(calendarsTable, eq(eventMappingsTable.calendarId, calendarsTable.id))
    .leftJoin(eventStatesTable, eq(eventMappingsTable.eventStateId, eventStatesTable.id))
    .where(and(eq(calendarsTable.userId, userId), gte(eventMappingsTable.endTime, now)))
    .orderBy(asc(eventMappingsTable.startTime), sourceEventIdentity)
    .limit(limit);

  return rows.map((row) => ({ ...row, startTime: row.startTime.toISOString() }));
};

const getCopiedEvents = async (
  database: KeeperDatabase,
  userId: string,
  limit: number,
  now: Date = new Date(),
): Promise<CopiedEvents> => {
  const [total, upcoming] = await Promise.all([
    countCopiedEvents(database, userId),
    listUpcomingCopiedEvents(database, userId, limit, now),
  ]);
  return { count: total, upcoming };
};

export { getCopiedEvents };
export type { CopiedEvent, CopiedEvents };
