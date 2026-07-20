import type { SyncRange } from "@keeper.sh/data-schemas";

interface SyncRangeOption {
  label: string;
  value: SyncRange;
}

const SYNC_RANGE_OPTIONS: readonly SyncRangeOption[] = [
  { label: "1 Week", value: "1_week" },
  { label: "1 Month", value: "1_month" },
  { label: "3 Months", value: "3_months" },
  { label: "6 Months", value: "6_months" },
  { label: "12 Months", value: "12_months" },
  { label: "2 Years", value: "2_years" },
];

const SYNC_RANGE_LABELS = Object.fromEntries(
  SYNC_RANGE_OPTIONS.map(({ label, value }) => [value, label]),
) as Record<SyncRange, string>;

const getSyncRangeLabel = (range: SyncRange): string => SYNC_RANGE_LABELS[range];

export { getSyncRangeLabel, SYNC_RANGE_OPTIONS };
export type { SyncRangeOption };
