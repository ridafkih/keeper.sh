import { calendarsTable, sourceDestinationMappingsTable } from "@keeper.sh/database/schema";
import { and, eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { BunSQLClient } from "../database-client";
import { resolveEffectiveDestinationIds, resolveEffectiveSources } from "./source-chain";
import type { EffectiveSource } from "./source-chain";

type SyncMappingReader = Pick<BunSQLClient, "select">;
type StoredSyncMapping = typeof sourceDestinationMappingsTable.$inferSelect;

const sourceCalendarsTable = alias(calendarsTable, "mapping_source_calendars");
const destinationCalendarsTable = alias(calendarsTable, "mapping_destination_calendars");

const readSyncMappingsOwnedBy = async (
  database: SyncMappingReader,
  ownerUserId: SQL | string,
): Promise<StoredSyncMapping[]> => {
  const rows = await database
    .select({ mapping: sourceDestinationMappingsTable })
    .from(sourceDestinationMappingsTable)
    .innerJoin(
      sourceCalendarsTable,
      eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarsTable.id),
    )
    .innerJoin(
      destinationCalendarsTable,
      eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarsTable.id),
    )
    .where(and(
      eq(sourceCalendarsTable.userId, ownerUserId),
      eq(destinationCalendarsTable.userId, sourceCalendarsTable.userId),
    ));

  return rows.map(({ mapping }) => mapping);
};

const getUserSyncMappings = (
  database: SyncMappingReader,
  userId: string,
): Promise<StoredSyncMapping[]> => readSyncMappingsOwnedBy(database, userId);

const getSyncMappingsOfCalendarOwner = (
  database: SyncMappingReader,
  calendarId: string,
): Promise<StoredSyncMapping[]> =>
  readSyncMappingsOwnedBy(
    database,
    sql`(select ${calendarsTable.userId} from ${calendarsTable} where ${calendarsTable.id} = ${calendarId})`,
  );

const getEffectiveSourcesForDestination = async (
  database: SyncMappingReader,
  destinationCalendarId: string,
): Promise<EffectiveSource[]> =>
  resolveEffectiveSources(
    await getSyncMappingsOfCalendarOwner(database, destinationCalendarId),
    destinationCalendarId,
  );

const getEffectiveDestinationIdsForSource = async (
  database: SyncMappingReader,
  sourceCalendarId: string,
): Promise<string[]> =>
  resolveEffectiveDestinationIds(
    await getSyncMappingsOfCalendarOwner(database, sourceCalendarId),
    sourceCalendarId,
  );

export {
  getEffectiveDestinationIdsForSource,
  getEffectiveSourcesForDestination,
  getSyncMappingsOfCalendarOwner,
  getUserSyncMappings,
};
export type { StoredSyncMapping, SyncMappingReader };
