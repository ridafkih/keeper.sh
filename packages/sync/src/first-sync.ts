import { sourceDestinationMappingsTable } from "@keeper.sh/database/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

type FirstSyncDatabase = Pick<BunSQLDatabase, "update">;

const recordFirstSyncedMappings = async (
  database: FirstSyncDatabase,
  destinationCalendarId: string,
  sourceCalendarIds: string[],
): Promise<string[]> => {
  if (sourceCalendarIds.length === 0) {
    return [];
  }
  const rows = await database
    .update(sourceDestinationMappingsTable)
    .set({ firstSyncedAt: new Date() })
    .where(and(
      eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId),
      inArray(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarIds),
      isNull(sourceDestinationMappingsTable.firstSyncedAt),
    ))
    .returning({ sourceCalendarId: sourceDestinationMappingsTable.sourceCalendarId });
  return rows.map(({ sourceCalendarId }) => sourceCalendarId);
};

export { recordFirstSyncedMappings };
