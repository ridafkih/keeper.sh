import { calendarsTable, sourceDestinationMappingsTable } from "@keeper.sh/database/schema";
import { createRequiredSourceRanges, createSourceIngestionPlan } from "@keeper.sh/calendar";
import type { SourceIngestionPlan, StoredDestinationRanges } from "@keeper.sh/calendar";
import { and, arrayContains, eq } from "drizzle-orm";
import type { KeeperDatabase } from "@/types";

type DestinationRangesReader = (sourceCalendarId: string) => Promise<StoredDestinationRanges[]>;

const createDestinationRangesReader = (
  database: KeeperDatabase,
): DestinationRangesReader => (sourceCalendarId) => database
  .select({
    syncFutureRange: calendarsTable.syncFutureRange,
    syncHistoricRange: calendarsTable.syncHistoricRange,
  })
  .from(sourceDestinationMappingsTable)
  .innerJoin(
    calendarsTable,
    eq(sourceDestinationMappingsTable.destinationCalendarId, calendarsTable.id),
  )
  .where(and(
    eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId),
    eq(calendarsTable.disabled, false),
    arrayContains(calendarsTable.capabilities, ["push"]),
  ));

const buildSourceIngestionPlan = async (
  sourceCalendarId: string,
  readDestinationRanges: DestinationRangesReader,
  now: Date = new Date(),
): Promise<SourceIngestionPlan> => {
  const ranges = createRequiredSourceRanges(await readDestinationRanges(sourceCalendarId));
  return createSourceIngestionPlan(ranges.historicRange, ranges.futureRange, now);
};

export { buildSourceIngestionPlan, createDestinationRangesReader };
export type { DestinationRangesReader };
