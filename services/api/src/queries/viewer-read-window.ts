import {
  overlapsRepresentableTimeWindow,
  overlapsTimeWindow,
  resolveIsAllDayEvent,
  resolveRepresentableTimeRange,
  wallTimeToInstant,
} from "@keeper.sh/calendar";

interface ReadWindowRange {
  endTime: Date;
  isAllDay?: boolean;
  startTime: Date;
}

const projectAllDayRangeToZone = (range: ReadWindowRange, timeZone: string): ReadWindowRange => {
  const { endTime, startTime } = resolveRepresentableTimeRange(range);
  return {
    endTime: wallTimeToInstant(endTime, timeZone),
    startTime: wallTimeToInstant(startTime, timeZone),
  };
};

const overlapsViewerReadWindow = (
  range: ReadWindowRange,
  windowStart: Date,
  windowEnd: Date,
  timeZone: string | undefined,
): boolean => {
  if (!timeZone || !resolveIsAllDayEvent(range)) {
    return overlapsRepresentableTimeWindow(range, windowStart, windowEnd);
  }
  return overlapsTimeWindow(projectAllDayRangeToZone(range, timeZone), windowStart, windowEnd);
};

export { overlapsViewerReadWindow };
export type { ReadWindowRange };
