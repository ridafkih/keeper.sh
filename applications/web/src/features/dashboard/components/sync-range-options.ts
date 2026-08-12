import { SYNC_RANGE_DEFINITIONS, type SyncRange } from "@keeper.sh/data-schemas";

interface SyncRangeOption {
  label: string;
  value: SyncRange;
}

const SYNC_RANGE_OPTIONS: readonly SyncRangeOption[] = SYNC_RANGE_DEFINITIONS;

const SYNC_RANGE_LABELS = Object.fromEntries(
  SYNC_RANGE_OPTIONS.map(({ label, value }) => [value, label]),
) as Record<SyncRange, string>;

const getSyncRangeLabel = (range: SyncRange): string => SYNC_RANGE_LABELS[range];

export { getSyncRangeLabel, SYNC_RANGE_OPTIONS };
export type { SyncRangeOption };
