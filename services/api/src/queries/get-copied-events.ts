import { getUserSyncMappings, listEffectiveMappings } from "@keeper.sh/calendar";
import type { EffectiveMapping } from "@keeper.sh/calendar";
import { calendarsTable, eventMappingsTable, eventStatesTable } from "@keeper.sh/database/schema";
import { and, asc, countDistinct, eq, gte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { KeeperDatabase } from "@/types";

interface CopiedEvent {
  id: string;
  title: string | null;
  startTime: string;
  sourceCalendarId: string | null;
  destinationCalendarId: string;
  viaCalendarIds: string[];
}

interface CopiedEvents {
  count: number;
  upcoming: CopiedEvent[];
}

const sourceEventIdentity = sql`coalesce(${eventMappingsTable.syncEventId}, ${eventMappingsTable.eventStateId}::text)`;

const throughEffectiveMappings = (mappings: EffectiveMapping[]): SQL => {
  const pairs = mappings.map((mapping) =>
    sql`(${mapping.sourceCalendarId}::uuid, ${mapping.destinationCalendarId}::uuid)`);
  return sql`(${eventMappingsTable.sourceCalendarId}, ${eventMappingsTable.calendarId}) in (${sql.join(pairs, sql`, `)})`;
};

const countCopiedEvents = async (
  database: KeeperDatabase,
  userId: string,
  mappings: EffectiveMapping[],
): Promise<number> => {
  const [row] = await database
    .select({ value: countDistinct(sourceEventIdentity) })
    .from(eventMappingsTable)
    .innerJoin(calendarsTable, eq(eventMappingsTable.calendarId, calendarsTable.id))
    .where(and(eq(calendarsTable.userId, userId), throughEffectiveMappings(mappings)));
  return row?.value ?? 0;
};

const createViaCalendarIdsResolver = (mappings: EffectiveMapping[]) => {
  const viaCalendarIdsByPair = new Map(mappings.map((mapping) => [
    `${mapping.sourceCalendarId}:${mapping.destinationCalendarId}`,
    mapping.viaCalendarIds,
  ]));
  return (sourceCalendarId: string | null, destinationCalendarId: string): string[] =>
    viaCalendarIdsByPair.get(`${sourceCalendarId}:${destinationCalendarId}`) ?? [];
};

const listUpcomingCopiedEvents = async (
  database: KeeperDatabase,
  userId: string,
  mappings: EffectiveMapping[],
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
    .innerJoin(calendarsTable, eq(eventMappingsTable.calendarId, calendarsTable.id))
    .leftJoin(eventStatesTable, eq(eventMappingsTable.eventStateId, eventStatesTable.id))
    .where(and(
      eq(calendarsTable.userId, userId),
      throughEffectiveMappings(mappings),
      gte(eventMappingsTable.endTime, now),
    ))
    .orderBy(asc(eventMappingsTable.startTime), sourceEventIdentity)
    .limit(limit);

  const resolveViaCalendarIds = createViaCalendarIdsResolver(mappings);
  return rows.map((row) => ({
    ...row,
    startTime: row.startTime.toISOString(),
    viaCalendarIds: resolveViaCalendarIds(row.sourceCalendarId, row.destinationCalendarId),
  }));
};

const getCopiedEvents = async (
  database: KeeperDatabase,
  userId: string,
  limit: number,
  now: Date = new Date(),
): Promise<CopiedEvents> => {
  const mappings = listEffectiveMappings(await getUserSyncMappings(database, userId));
  if (mappings.length === 0) {
    return { count: 0, upcoming: [] };
  }
  const [total, upcoming] = await Promise.all([
    countCopiedEvents(database, userId, mappings),
    listUpcomingCopiedEvents(database, userId, mappings, limit, now),
  ]);
  return { count: total, upcoming };
};

export { getCopiedEvents };
export type { CopiedEvent, CopiedEvents };
