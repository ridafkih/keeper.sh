import { calendarsTable, sourceDestinationMappingsTable } from "@keeper.sh/database/schema";
import { eq, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { BunSQLClient } from "../database-client";
import { resolveEffectiveDestinationIds, resolveEffectiveSources } from "./source-chain";
import type { EffectiveSource, SyncMapping } from "./source-chain";

type SyncMappingReader = Pick<BunSQLClient, "select">;
type MappingRow = typeof sourceDestinationMappingsTable.$inferSelect;

interface StoredSyncMapping extends MappingRow, SyncMapping {
  sourceUserId: string;
}

interface DestinationSourceChain {
  mappings: MappingRow[];
  sources: EffectiveSource[];
}

const sourceCalendarsTable = alias(calendarsTable, "mapping_source_calendars");
const destinationCalendarsTable = alias(calendarsTable, "mapping_destination_calendars");

const providerCalendarKeyOf = (
  calendars: typeof sourceCalendarsTable | typeof destinationCalendarsTable,
): SQL<string> =>
  sql<string>`coalesce(${calendars.externalCalendarId}, ${calendars.calendarUrl}, ${calendars.id}::text)`;

const readSyncMappingsOwnedBy = async (
  database: SyncMappingReader,
  ownerUserId: SQL | string,
): Promise<StoredSyncMapping[]> => {
  const rows = await database
    .select({
      destinationProviderCalendarKey: providerCalendarKeyOf(destinationCalendarsTable),
      isSameOwner: sql<boolean>`${sourceCalendarsTable.userId} = ${destinationCalendarsTable.userId}`,
      mapping: sourceDestinationMappingsTable,
      sourceProviderCalendarKey: providerCalendarKeyOf(sourceCalendarsTable),
      sourceUserId: sourceCalendarsTable.userId,
    })
    .from(sourceDestinationMappingsTable)
    .innerJoin(
      sourceCalendarsTable,
      eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarsTable.id),
    )
    .innerJoin(
      destinationCalendarsTable,
      eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarsTable.id),
    )
    .where(or(
      eq(sourceCalendarsTable.userId, ownerUserId),
      eq(destinationCalendarsTable.userId, ownerUserId),
    ));

  return rows.map(({ mapping, ...chain }) => ({ ...mapping, ...chain }));
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

const getDestinationSourceChain = async (
  database: SyncMappingReader,
  destinationCalendarId: string,
): Promise<DestinationSourceChain> => {
  const directMappings = await database
    .select()
    .from(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId));

  if (!directMappings.some((mapping) => mapping.includeUpstreamSources)) {
    return {
      mappings: directMappings,
      sources: directMappings.map(({ sourceCalendarId }) => ({
        sourceCalendarId,
        viaCalendarIds: [],
      })),
    };
  }

  const mappings = await getSyncMappingsOfCalendarOwner(database, destinationCalendarId);
  return { mappings, sources: resolveEffectiveSources(mappings, destinationCalendarId) };
};

const getEffectiveSourcesForDestination = async (
  database: SyncMappingReader,
  destinationCalendarId: string,
): Promise<EffectiveSource[]> => {
  const { sources } = await getDestinationSourceChain(database, destinationCalendarId);
  return sources;
};

const getEffectiveDestinationIdsForSource = async (
  database: SyncMappingReader,
  sourceCalendarId: string,
): Promise<string[]> =>
  resolveEffectiveDestinationIds(
    await getSyncMappingsOfCalendarOwner(database, sourceCalendarId),
    sourceCalendarId,
  );

export {
  getDestinationSourceChain,
  getEffectiveDestinationIdsForSource,
  getEffectiveSourcesForDestination,
  getUserSyncMappings,
};
export type { StoredSyncMapping, SyncMappingReader };
