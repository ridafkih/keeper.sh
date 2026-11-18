import { calendarsTable, sourceDestinationMappingsTable } from "@keeper.sh/database/schema";
import { and, arrayContains, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getEffectiveDestinationIdsForSource } from "./effective-sources";
import type { SyncMappingReader } from "./effective-sources";
import type { StoredDestinationRanges } from "./required-source-ranges";

const PUSH_CAPABILITY = "push";

const inheritingMappingsTable = alias(sourceDestinationMappingsTable, "inheriting_mappings");

const hasInheritingDestinations = sql<boolean>`exists (
  select 1 from ${sourceDestinationMappingsTable} as "inheriting_mappings"
  where ${inheritingMappingsTable.sourceCalendarId} = ${calendarsTable.id}
    and ${inheritingMappingsTable.includeUpstreamSources}
)`;

const getInheritingDestinationRanges = async (
  database: SyncMappingReader,
  sourceCalendarId: string,
  directDestinationIds: string[],
): Promise<StoredDestinationRanges[]> => {
  const directDestinationIdSet = new Set(directDestinationIds);
  const effectiveDestinationIds = await getEffectiveDestinationIdsForSource(
    database,
    sourceCalendarId,
  );
  const inheritingDestinationIds = effectiveDestinationIds
    .filter((destinationCalendarId) => !directDestinationIdSet.has(destinationCalendarId));
  if (inheritingDestinationIds.length === 0) {
    return [];
  }

  return database
    .select({
      syncFutureRange: calendarsTable.syncFutureRange,
      syncHistoricRange: calendarsTable.syncHistoricRange,
    })
    .from(calendarsTable)
    .where(and(
      inArray(calendarsTable.id, inheritingDestinationIds),
      eq(calendarsTable.disabled, false),
      arrayContains(calendarsTable.capabilities, [PUSH_CAPABILITY]),
    ));
};

const getEffectiveDestinationRangesForSource = async (
  database: SyncMappingReader,
  sourceCalendarId: string,
): Promise<StoredDestinationRanges[]> => {
  const directDestinations = await database
    .select({
      calendarId: calendarsTable.id,
      capabilities: calendarsTable.capabilities,
      disabled: calendarsTable.disabled,
      hasInheritingDestinations,
      syncFutureRange: calendarsTable.syncFutureRange,
      syncHistoricRange: calendarsTable.syncHistoricRange,
    })
    .from(sourceDestinationMappingsTable)
    .innerJoin(
      calendarsTable,
      eq(sourceDestinationMappingsTable.destinationCalendarId, calendarsTable.id),
    )
    .where(eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId));

  const directRanges = directDestinations
    .filter((destination) =>
      !destination.disabled && destination.capabilities.includes(PUSH_CAPABILITY))
    .map(({ syncFutureRange, syncHistoricRange }) => ({ syncFutureRange, syncHistoricRange }));

  if (!directDestinations.some((destination) => destination.hasInheritingDestinations)) {
    return directRanges;
  }

  return [
    ...directRanges,
    ...await getInheritingDestinationRanges(
      database,
      sourceCalendarId,
      directDestinations.map((destination) => destination.calendarId),
    ),
  ];
};

export { getEffectiveDestinationRangesForSource };
