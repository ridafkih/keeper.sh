import {
  calendarAccountsTable,
  calendarsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { eq, inArray, or, sql } from "drizzle-orm";
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

const sourceAccountsTable = alias(calendarAccountsTable, "mapping_source_accounts");
const destinationAccountsTable = alias(calendarAccountsTable, "mapping_destination_accounts");

const providerCalendarKeyOf = (
  calendars: typeof sourceCalendarsTable | typeof destinationCalendarsTable,
  accounts: typeof sourceAccountsTable | typeof destinationAccountsTable,
): SQL<string> =>
  sql<string>`coalesce(${accounts.provider} || ':' || coalesce(${calendars.externalCalendarId}, ${calendars.calendarUrl}), ${calendars.id}::text)`;

const qualifiedColumn = (qualifier: SQL, column: { name: string }): SQL =>
  sql`${qualifier}.${sql.identifier(column.name)}`;

const INHERITING_MAPPINGS = sql`${sql.identifier("inheriting_mappings")}`;

const feedsInheritingLink = sql<boolean>`exists (
  select 1 from ${sourceDestinationMappingsTable} as ${INHERITING_MAPPINGS}
  where ${qualifiedColumn(INHERITING_MAPPINGS, sourceDestinationMappingsTable.sourceCalendarId)}
    = ${qualifiedColumn(sql`${sourceDestinationMappingsTable}`, sourceDestinationMappingsTable.destinationCalendarId)}
    and ${qualifiedColumn(INHERITING_MAPPINGS, sourceDestinationMappingsTable.includeUpstreamSources)}
)`;

const readSyncMappingsOwnedBy = async (
  database: SyncMappingReader,
  ownerUserId: SQL | string,
): Promise<StoredSyncMapping[]> => {
  const rows = await database
    .select({
      destinationProviderCalendarKey: providerCalendarKeyOf(
        destinationCalendarsTable,
        destinationAccountsTable,
      ),
      isSameOwner: sql<boolean>`${sourceCalendarsTable.userId} = ${destinationCalendarsTable.userId}`,
      mapping: sourceDestinationMappingsTable,
      sourceProviderCalendarKey: providerCalendarKeyOf(sourceCalendarsTable, sourceAccountsTable),
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
    .innerJoin(sourceAccountsTable, eq(sourceCalendarsTable.accountId, sourceAccountsTable.id))
    .innerJoin(
      destinationAccountsTable,
      eq(destinationCalendarsTable.accountId, destinationAccountsTable.id),
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

const getEffectiveDestinationIdsForOwnedSources = async (
  database: SyncMappingReader,
  sourceCalendarIds: string[],
): Promise<string[]> => {
  const [ownedSourceCalendarId] = sourceCalendarIds;
  if (!ownedSourceCalendarId) {
    return [];
  }

  const directDestinations = await database
    .select({
      destinationCalendarId: sourceDestinationMappingsTable.destinationCalendarId,
      feedsInheritingLink,
    })
    .from(sourceDestinationMappingsTable)
    .where(inArray(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarIds));
  const directDestinationIds = directDestinations
    .map(({ destinationCalendarId }) => destinationCalendarId);

  if (!directDestinations.some((destination) => destination.feedsInheritingLink)) {
    return [...new Set(directDestinationIds)];
  }

  const mappings = await getSyncMappingsOfCalendarOwner(database, ownedSourceCalendarId);
  return [...new Set([
    ...directDestinationIds,
    ...sourceCalendarIds.flatMap((sourceCalendarId) =>
      resolveEffectiveDestinationIds(mappings, sourceCalendarId)),
  ])];
};

const getEffectiveDestinationIdsForSource = (
  database: SyncMappingReader,
  sourceCalendarId: string,
): Promise<string[]> => getEffectiveDestinationIdsForOwnedSources(database, [sourceCalendarId]);

export {
  getDestinationSourceChain,
  getEffectiveDestinationIdsForOwnedSources,
  getEffectiveDestinationIdsForSource,
  getEffectiveSourcesForDestination,
  getSyncMappingsOfCalendarOwner,
  getUserSyncMappings,
};
export type { StoredSyncMapping, SyncMappingReader };
