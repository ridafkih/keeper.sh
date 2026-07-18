import { normalizeTimezone } from "./normalize-timezone";

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const HOURS_TO_SAMPLE = 36;
const SAMPLE_INTERVAL_HOURS = 6;
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

const resolveTimeZone = (timeZone: string | undefined): string | undefined => {
  const normalizedTimeZone = normalizeTimezone(timeZone);
  if (!normalizedTimeZone) {
    return;
  }

  try {
    getDateTimeFormatter(normalizedTimeZone).format(0);
  } catch {
    throw new RangeError(`Unsupported calendar timezone: ${timeZone}`);
  }
  return normalizedTimeZone;
};

const resolveSupportedTimeZone = (timeZone: string | undefined): string | undefined => {
  try {
    return resolveTimeZone(timeZone);
  } catch (error) {
    if (error instanceof RangeError) {
      return;
    }
    throw error;
  }
};

const instantToWallTime = (date: Date, timeZone: string): Date => {
  const values = new Map(
    getDateTimeFormatter(timeZone).formatToParts(date).map((part) => [part.type, part.value]),
  );
  const readPart = (name: Intl.DateTimeFormatPartTypes): number =>
    Number(values.get(name));

  return new Date(Date.UTC(
    readPart("year"),
    readPart("month") - 1,
    readPart("day"),
    readPart("hour"),
    readPart("minute"),
    readPart("second"),
    date.getUTCMilliseconds(),
  ));
};

const getTimeZoneOffsetMinutes = (instant: Date, timeZone: string): number =>
  Math.round((instantToWallTime(instant, timeZone).getTime() - instant.getTime()) / 60_000);

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

const wallTimeToInstant = (wallTime: Date, timeZone: string): Date => {
  const desiredTime = wallTime.getTime();
  const offsets = new Set<number>();
  for (
    let hours = -HOURS_TO_SAMPLE;
    hours <= HOURS_TO_SAMPLE;
    hours += SAMPLE_INTERVAL_HOURS
  ) {
    const sampleTime = desiredTime + hours * MS_PER_HOUR;
    const observedTime = instantToWallTime(new Date(sampleTime), timeZone).getTime();
    offsets.add(observedTime - sampleTime);
  }

  const candidates = [...offsets].map((offset) => {
    const instant = desiredTime - offset;
    const observedWallTime = instantToWallTime(new Date(instant), timeZone).getTime();
    return { instant, observedWallTime };
  });
  const exactMatches = candidates
    .filter((candidate) => candidate.observedWallTime === desiredTime)
    .toSorted((first, second) => first.instant - second.instant);
  if (exactMatches[0]) {
    // During a fold, choose the earlier of the two valid instants.
    return new Date(exactMatches[0].instant);
  }

  const [firstValidTimeAfterGap] = candidates
    .filter((candidate) => candidate.observedWallTime > desiredTime)
    .toSorted((first, second) =>
      first.observedWallTime - second.observedWallTime
      || first.instant - second.instant);
  if (firstValidTimeAfterGap) {
    // During a gap, shift forward by the size of the timezone transition.
    return new Date(firstValidTimeAfterGap.instant);
  }

  throw new RangeError(`Unable to resolve wall time in timezone ${timeZone}`);
};

export {
  findTimeZoneTransitions,
  getTimeZoneOffsetMinutes,
  instantToWallTime,
  resolveSupportedTimeZone,
  resolveTimeZone,
  wallTimeToInstant,
};
export type { TimeZoneTransition };
