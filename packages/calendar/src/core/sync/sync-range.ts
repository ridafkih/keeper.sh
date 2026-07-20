import type { SyncRange } from "@keeper.sh/data-schemas";

const DEFAULT_HISTORIC_SYNC_RANGE: SyncRange = "1_week";
const DEFAULT_FUTURE_SYNC_RANGE: SyncRange = "2_years";

const SYNC_RANGE_ORDER: Record<SyncRange, number> = {
  "1_week": 0,
  "1_month": 1,
  "3_months": 2,
  "6_months": 3,
  "12_months": 4,
  "2_years": 5,
};

const SYNC_RANGE_MONTHS: Partial<Record<SyncRange, number>> = {
  "1_month": 1,
  "3_months": 3,
  "6_months": 6,
  "12_months": 12,
  "2_years": 24,
};

interface ConfigurableSyncWindow {
  timeMin: Date;
  timeMax: Date;
}

const getStartOfToday = (now: Date = new Date()): Date => {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return today;
};

const shiftDateByMonths = (date: Date, months: number): Date => {
  const shifted = new Date(date);
  const desiredDay = shifted.getDate();
  shifted.setDate(1);
  shifted.setMonth(shifted.getMonth() + months);
  const lastDayOfTargetMonth = new Date(
    shifted.getFullYear(),
    shifted.getMonth() + 1,
    0,
  ).getDate();
  shifted.setDate(Math.min(desiredDay, lastDayOfTargetMonth));
  return shifted;
};

const shiftDateByRange = (date: Date, range: SyncRange, direction: -1 | 1): Date => {
  if (range === "1_week") {
    const shifted = new Date(date);
    shifted.setDate(shifted.getDate() + direction * 7);
    return shifted;
  }

  const months = SYNC_RANGE_MONTHS[range];
  if (typeof months !== "number") {
    throw new RangeError(`Unsupported sync range: ${range}`);
  }
  return shiftDateByMonths(date, direction * months);
};

const getConfigurableSyncWindow = (
  historicRange: SyncRange,
  futureRange: SyncRange,
  now: Date = new Date(),
): ConfigurableSyncWindow => {
  const anchor = getStartOfToday(now);
  return {
    timeMin: shiftDateByRange(anchor, historicRange, -1),
    timeMax: shiftDateByRange(anchor, futureRange, 1),
  };
};

const getWiderSyncRange = (first: SyncRange, second: SyncRange): SyncRange => {
  if (SYNC_RANGE_ORDER[first] >= SYNC_RANGE_ORDER[second]) {
    return first;
  }
  return second;
};

const isSyncRangeWider = (candidate: SyncRange, current: SyncRange): boolean =>
  SYNC_RANGE_ORDER[candidate] > SYNC_RANGE_ORDER[current];

export {
  DEFAULT_FUTURE_SYNC_RANGE,
  DEFAULT_HISTORIC_SYNC_RANGE,
  getConfigurableSyncWindow,
  getStartOfToday,
  getWiderSyncRange,
  isSyncRangeWider,
};
export type { ConfigurableSyncWindow };
