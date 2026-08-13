import { syncRangeSchema, type SyncRange } from "@keeper.sh/data-schemas";
import {
  DEFAULT_FUTURE_SYNC_RANGE,
  DEFAULT_HISTORIC_SYNC_RANGE,
  getWiderSyncRange,
} from "./sync-range";

interface RequiredSourceRanges {
  futureRange: SyncRange;
  historicRange: SyncRange;
}

interface StoredDestinationRanges {
  syncFutureRange: string;
  syncHistoricRange: string;
}

const BASE_SOURCE_SYNC_RANGES: RequiredSourceRanges = {
  futureRange: DEFAULT_FUTURE_SYNC_RANGE,
  historicRange: DEFAULT_HISTORIC_SYNC_RANGE,
};

const createRequiredSourceRanges = (
  destinations: StoredDestinationRanges[],
): RequiredSourceRanges => {
  let ranges = BASE_SOURCE_SYNC_RANGES;
  for (const destination of destinations) {
    ranges = {
      futureRange: getWiderSyncRange(
        ranges.futureRange,
        syncRangeSchema.assert(destination.syncFutureRange),
      ),
      historicRange: getWiderSyncRange(
        ranges.historicRange,
        syncRangeSchema.assert(destination.syncHistoricRange),
      ),
    };
  }
  return ranges;
};

export { BASE_SOURCE_SYNC_RANGES, createRequiredSourceRanges };
export type { RequiredSourceRanges, StoredDestinationRanges };
