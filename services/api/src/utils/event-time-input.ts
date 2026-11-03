import { resolveTimeZone, wallTimeToInstant } from "@keeper.sh/calendar";

interface EventTimeInputOptions {
  isAllDay: boolean;
}

interface CalendarDate {
  day: number;
  month: number;
  year: number;
}

interface WallClock {
  hour: number;
  millisecond: number;
  minute: number;
  second: number;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})?$/i;
const OFFSET_PATTERN = /^([+-])(\d{2}):(\d{2})$/;
const MILLISECOND_DIGITS = 3;
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const SECONDS_PER_MINUTE = 60;

class EventTimeInputError extends RangeError {
  override name = "EventTimeInputError";
}

const toCalendarDateInstant = ({ day, month, year }: CalendarDate): Date =>
  new Date(Date.UTC(year, month - 1, day));

const readCalendarDate = (value: string, year: string, month: string, day: string): CalendarDate => {
  const date = { day: Number(day), month: Number(month), year: Number(year) };
  const instant = toCalendarDateInstant(date);
  const isRealDate = instant.getUTCFullYear() === date.year
    && instant.getUTCMonth() === date.month - 1
    && instant.getUTCDate() === date.day;
  if (!isRealDate) {
    throw new EventTimeInputError(`Event time ${value} is not a real calendar date.`);
  }
  return date;
};

const readFractionMilliseconds = (fraction: string | undefined): number =>
  Number((fraction ?? "").slice(0, MILLISECOND_DIGITS).padEnd(MILLISECOND_DIGITS, "0"));

const readWallClock = (
  value: string,
  hour: string,
  minute: string,
  second: string | undefined,
  fraction: string | undefined,
): WallClock => {
  const clock = {
    hour: Number(hour),
    millisecond: readFractionMilliseconds(fraction),
    minute: Number(minute),
    second: Number(second ?? "0"),
  };
  if (clock.hour >= HOURS_PER_DAY || clock.minute >= MINUTES_PER_HOUR || clock.second >= SECONDS_PER_MINUTE) {
    throw new EventTimeInputError(`Event time ${value} is not a real time of day.`);
  }
  return clock;
};

const readOffsetMinutes = (value: string, designator: string): number => {
  const match = OFFSET_PATTERN.exec(designator);
  if (!match) {
    return 0;
  }
  const [, sign, hours, minutes] = match;
  if (Number(hours) >= HOURS_PER_DAY || Number(minutes) >= MINUTES_PER_HOUR) {
    throw new EventTimeInputError(`Event time ${value} has an impossible UTC offset.`);
  }
  const magnitude = (Number(hours) * MINUTES_PER_HOUR) + Number(minutes);
  if (sign === "-") {
    return -magnitude;
  }
  return magnitude;
};

const toWallTime = (date: CalendarDate, clock: WallClock): Date =>
  new Date(Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    clock.hour,
    clock.minute,
    clock.second,
    clock.millisecond,
  ));

const resolveRequestedTimeZone = (timeZone: string | undefined): string | undefined => {
  if (typeof timeZone !== "string") {
    return;
  }
  try {
    const resolved = resolveTimeZone(timeZone);
    if (resolved) {
      return resolved;
    }
  } catch (error) {
    throw new EventTimeInputError(`Unsupported timezone: ${timeZone}`, { cause: error });
  }
  throw new EventTimeInputError(`Unsupported timezone: ${timeZone}`);
};

const resolveWallTimeInZone = (value: string, wallTime: Date, timeZone: string | undefined): Date => {
  if (!timeZone) {
    throw new EventTimeInputError(
      `Event time ${value} has no UTC offset, so the timezone field is required to read it.`,
    );
  }
  try {
    return wallTimeToInstant(wallTime, timeZone);
  } catch (error) {
    throw new EventTimeInputError(`Event time ${value} does not exist in timezone ${timeZone}.`, { cause: error });
  }
};

const parseDateOnly = (value: string, match: RegExpExecArray, { isAllDay }: EventTimeInputOptions): Date => {
  const [, year = "", month = "", day = ""] = match;
  const date = readCalendarDate(value, year, month, day);
  if (!isAllDay) {
    throw new EventTimeInputError(`Event time ${value} is a date, but the event is not all-day.`);
  }
  return toCalendarDateInstant(date);
};

const parseDateTime = (
  value: string,
  match: RegExpExecArray,
  timeZone: string | undefined,
  { isAllDay }: EventTimeInputOptions,
): Date => {
  const [, year = "", month = "", day = "", hour = "", minute = "", second, fraction, designator] = match;
  const date = readCalendarDate(value, year, month, day);
  const clock = readWallClock(value, hour, minute, second, fraction);
  const wallTime = toWallTime(date, clock);
  const offsetMinutes = designator && readOffsetMinutes(value, designator);

  if (isAllDay) {
    return toCalendarDateInstant(date);
  }
  if (typeof offsetMinutes !== "number") {
    return resolveWallTimeInZone(value, wallTime, timeZone);
  }
  return new Date(wallTime.getTime() - (offsetMinutes * MS_PER_MINUTE));
};

const parseEventTimeInput = (
  value: string,
  timeZone: string | undefined,
  options: EventTimeInputOptions,
): Date => {
  const resolvedTimeZone = resolveRequestedTimeZone(timeZone);

  const dateMatch = DATE_PATTERN.exec(value);
  if (dateMatch) {
    return parseDateOnly(value, dateMatch, options);
  }

  const dateTimeMatch = DATE_TIME_PATTERN.exec(value);
  if (dateTimeMatch) {
    return parseDateTime(value, dateTimeMatch, resolvedTimeZone, options);
  }

  throw new EventTimeInputError(`Event time ${value} is not an ISO 8601 date or date-time.`);
};

const toCanonicalEventTime = (
  value: string,
  timeZone: string | undefined,
  options: EventTimeInputOptions,
): string => parseEventTimeInput(value, timeZone, options).toISOString();

const assertSupportedEventTimeZone = (timeZone: string | undefined): void => {
  resolveRequestedTimeZone(timeZone);
};

export { EventTimeInputError, assertSupportedEventTimeZone, parseEventTimeInput, toCanonicalEventTime };
export type { EventTimeInputOptions };
