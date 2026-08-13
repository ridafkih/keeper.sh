import {
  DEFAULT_FUTURE_SYNC_RANGE,
  DEFAULT_HISTORIC_SYNC_RANGE,
  SYNC_RANGE_DEFINITIONS,
  type SyncRange,
} from "@keeper.sh/data-schemas";

const SYNC_RANGE_ORDER = new Map<SyncRange, number>(
  SYNC_RANGE_DEFINITIONS.map(({ value }, index) => [value, index]),
);

interface SyncWindow {
  timeMin: Date;
  timeMax: Date;
}

interface SourceIngestionPlan {
  futureRange: SyncRange;
  historicRange: SyncRange;
  window: SyncWindow;
}

const createSyncWindow = (timeMin: Date, timeMax: Date): SyncWindow => {
  if (!Number.isFinite(timeMin.getTime()) || !Number.isFinite(timeMax.getTime())) {
    throw new RangeError("Sync window boundaries must be valid dates");
  }
  if (timeMin >= timeMax) {
    throw new RangeError("Sync window start must be before its end");
  }
  return { timeMax, timeMin };
};

const intersectSyncWindows = (
  first: SyncWindow,
  second: SyncWindow,
): SyncWindow | null => {
  const { timeMax: firstTimeMax, timeMin: firstTimeMin } = first;
  let { timeMin } = second;
  if (firstTimeMin > second.timeMin) {
    timeMin = firstTimeMin;
  }
  let { timeMax } = second;
  if (firstTimeMax < second.timeMax) {
    timeMax = firstTimeMax;
  }
  if (timeMin >= timeMax) {
    return null;
  }
  return { timeMax, timeMin };
};

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
  const definition = SYNC_RANGE_DEFINITIONS.find(({ value }) => value === range);
  if (!definition) {
    throw new RangeError(`Unsupported sync range: ${range}`);
  }
  if (definition.shift.unit === "days") {
    const shifted = new Date(date);
    shifted.setDate(shifted.getDate() + direction * definition.shift.amount);
    return shifted;
  }
  return shiftDateByMonths(date, direction * definition.shift.amount);
};

const getConfigurableSyncWindow = (
  historicRange: SyncRange,
  futureRange: SyncRange,
  now: Date = new Date(),
): SyncWindow => {
  const anchor = getStartOfToday(now);
  return createSyncWindow(
    shiftDateByRange(anchor, historicRange, -1),
    shiftDateByRange(anchor, futureRange, 1),
  );
};

const createSourceIngestionPlan = (
  historicRange: SyncRange,
  futureRange: SyncRange,
  now: Date = new Date(),
): SourceIngestionPlan => ({
  futureRange,
  historicRange,
  window: getConfigurableSyncWindow(historicRange, futureRange, now),
});

const getSyncRangeOrder = (range: SyncRange): number => {
  const order = SYNC_RANGE_ORDER.get(range);
  if (typeof order !== "number") {
    throw new RangeError(`Unsupported sync range: ${range}`);
  }
  return order;
};

const getWiderSyncRange = (first: SyncRange, second: SyncRange): SyncRange => {
  if (getSyncRangeOrder(first) >= getSyncRangeOrder(second)) {
    return first;
  }
  return second;
};

export {
  DEFAULT_FUTURE_SYNC_RANGE,
  DEFAULT_HISTORIC_SYNC_RANGE,
  createSyncWindow,
  createSourceIngestionPlan,
  getConfigurableSyncWindow,
  getStartOfToday,
  getSyncRangeOrder,
  getWiderSyncRange,
  intersectSyncWindows,
};
export type { SourceIngestionPlan, SyncWindow };
