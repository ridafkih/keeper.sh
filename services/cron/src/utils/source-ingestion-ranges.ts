import {
  DEFAULT_FUTURE_SYNC_RANGE,
  DEFAULT_HISTORIC_SYNC_RANGE,
  getWiderSyncRange,
} from "@keeper.sh/calendar";
import { syncRangeSchema } from "@keeper.sh/data-schemas";
import type { RequiredSourceRanges } from "./oauth-ingestion-state";

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
export type { StoredDestinationRanges };
