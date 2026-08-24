import { normalizeTimezone } from "./normalize-timezone";

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const MINUTES_PER_HOUR = 60;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

interface TimeZoneTransition {
  instant: Date;
  offsetFromMinutes: number;
  offsetToMinutes: number;
}

const getDateTimeFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const existing = dateTimeFormatters.get(timeZone);
  if (existing) {
    return existing;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    calendar: "iso8601",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    numberingSystem: "latn",
    second: "2-digit",
    timeZone,
    year: "numeric",
  });
  dateTimeFormatters.set(timeZone, formatter);
  return formatter;
};

const formatIcsUtcOffset = (offsetMinutes: number): string => {
  let sign = "+";
  if (offsetMinutes < 0) {
    sign = "-";
  }
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / MINUTES_PER_HOUR).toString().padStart(2, "0");
  const minutes = (absolute % MINUTES_PER_HOUR).toString().padStart(2, "0");
  return `${sign}${hours}${minutes}`;
};

const isSupportedTimeZone = (timeZone: string | undefined): boolean => {
  const normalizedTimeZone = normalizeTimezone(timeZone);
  if (!normalizedTimeZone) {
    return true;
  }

  try {
    getDateTimeFormatter(normalizedTimeZone).format(0);
  } catch {
    return false;
  }
  return true;
};

const resolveTimeZone = (timeZone: string | undefined): string | undefined => {
  const normalizedTimeZone = normalizeTimezone(timeZone);
  if (!normalizedTimeZone) {
    return;
  }
  if (!isSupportedTimeZone(normalizedTimeZone)) {
    throw new RangeError(`Unsupported calendar timezone: ${timeZone}`);
  }
  return normalizedTimeZone;
};

const instantToWallTime = (date: Date, timeZone: string): Date => {
  let year = Number.NaN;
  let month = Number.NaN;
  let day = Number.NaN;
  let hour = Number.NaN;
  let minute = Number.NaN;
  let second = Number.NaN;

  for (const part of getDateTimeFormatter(timeZone).formatToParts(date)) {
    switch (part.type) {
      case "year": {
        year = Number(part.value);
        break;
      }
      case "month": {
        month = Number(part.value);
        break;
      }
      case "day": {
        day = Number(part.value);
        break;
      }
      case "hour": {
        hour = Number(part.value);
        break;
      }
      case "minute": {
        minute = Number(part.value);
        break;
      }
      case "second": {
        second = Number(part.value);
        break;
      }
      default: {
        break;
      }
    }
  }

  return new Date(Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    date.getUTCMilliseconds(),
  ));
};

const getTimeZoneOffsetMilliseconds = (instant: Date, timeZone: string): number =>
  instantToWallTime(instant, timeZone).getTime() - instant.getTime();

const getTimeZoneOffsetMinutes = (instant: Date, timeZone: string): number =>
  Math.round(getTimeZoneOffsetMilliseconds(instant, timeZone) / 60_000);

const findTransitionInstant = (
  lowerBound: number,
  upperBound: number,
  timeZone: string,
  offsetFromMinutes: number,
): number => {
  let lower = lowerBound;
  let upper = upperBound;
  while (upper - lower > 1) {
    const midpoint = Math.floor((lower + upper) / 2);
    const midpointOffset = getTimeZoneOffsetMinutes(new Date(midpoint), timeZone);
    if (midpointOffset === offsetFromMinutes) {
      lower = midpoint;
    } else {
      upper = midpoint;
    }
  }
  return upper;
};

const findTimeZoneTransitions = (
  timeZone: string,
  start: Date,
  end: Date,
): TimeZoneTransition[] => {
  if (
    Number.isNaN(start.getTime())
    || Number.isNaN(end.getTime())
    || start >= end
  ) {
    throw new RangeError("Timezone transition discovery requires a valid, non-empty window");
  }

  const transitions: TimeZoneTransition[] = [];
  let previousSample = start.getTime();
  let previousOffset = getTimeZoneOffsetMinutes(start, timeZone);

  for (
    let sample = Math.min(previousSample + MS_PER_DAY, end.getTime());
    sample <= end.getTime();
    sample = Math.min(sample + MS_PER_DAY, end.getTime())
  ) {
    const currentOffset = getTimeZoneOffsetMinutes(new Date(sample), timeZone);
    if (currentOffset !== previousOffset) {
      const instant = findTransitionInstant(
        previousSample,
        sample,
        timeZone,
        previousOffset,
      );
      transitions.push({
        instant: new Date(instant),
        offsetFromMinutes: previousOffset,
        offsetToMinutes: currentOffset,
      });
      previousOffset = currentOffset;
    }
    if (sample === end.getTime()) {
      break;
    }
    previousSample = sample;
  }

  return transitions;
};

// Premise: no zone transitions twice within a day either side of a wall time, so two probes name every candidate offset.
const wallTimeToInstant = (wallTime: Date, timeZone: string): Date => {
  const desiredTime = wallTime.getTime();
  const offsetBefore = getTimeZoneOffsetMilliseconds(
    new Date(desiredTime - MS_PER_DAY),
    timeZone,
  );
  const offsetAfter = getTimeZoneOffsetMilliseconds(
    new Date(desiredTime + MS_PER_DAY),
    timeZone,
  );
  if (offsetBefore === offsetAfter) {
    return new Date(desiredTime - offsetBefore);
  }

  const matches = [offsetBefore, offsetAfter]
    .map((offset) => desiredTime - offset)
    .filter((instant) =>
      getTimeZoneOffsetMilliseconds(new Date(instant), timeZone) === desiredTime - instant);
  if (matches.length > 0) {
    // During a fold, choose the earlier of the two valid instants.
    return new Date(Math.min(...matches));
  }

  if (offsetAfter > offsetBefore) {
    // During a gap, shift forward by the size of the timezone transition.
    return new Date(desiredTime - offsetBefore);
  }

  throw new RangeError(`Unable to resolve wall time in timezone ${timeZone}`);
};

export {
  findTimeZoneTransitions,
  formatIcsUtcOffset,
  getTimeZoneOffsetMinutes,
  instantToWallTime,
  isSupportedTimeZone,
  resolveTimeZone,
  wallTimeToInstant,
};
export type { TimeZoneTransition };
