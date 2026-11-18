import {
  createRequiredSourceRanges,
  createSourceIngestionPlan,
  getEffectiveDestinationRangesForSource,
} from "@keeper.sh/calendar";
import type { SourceIngestionPlan, StoredDestinationRanges } from "@keeper.sh/calendar";
import type { KeeperDatabase } from "@/types";

type DestinationRangesReader = (sourceCalendarId: string) => Promise<StoredDestinationRanges[]>;

const createDestinationRangesReader = (
  database: KeeperDatabase,
): DestinationRangesReader => (sourceCalendarId) =>
  getEffectiveDestinationRangesForSource(database, sourceCalendarId);

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
