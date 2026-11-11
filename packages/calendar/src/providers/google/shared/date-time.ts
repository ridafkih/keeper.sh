import type { PartialGoogleDateTime } from "../types";
import { resolveTimeZone, wallTimeToInstant } from "../../../ics/utils/timezone-instant";

const RFC3339_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|[+-]\d{2}:\d{2})?$/;
const RFC3339_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const isCalendarDate = (year: number, month: number, day: number): boolean => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const isClockTime = (hour: number, minute: number, second: number): boolean =>
  hour < 24 && minute < 60 && second < 60;

const readTimeZone = (timeZone: string | undefined): string | undefined => {
  try {
    return resolveTimeZone(timeZone);
  } catch {
    return globalThis.undefined;
  }
};

const readWallDateTime = (match: RegExpExecArray): Date | null => {
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  if (
    !isCalendarDate(Number(year), Number(month), Number(day))
    || !isClockTime(Number(hour), Number(minute), Number(second))
  ) {
    return null;
  }
  return new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(`0.${fraction || "0"}`) * 1000,
  ));
};

const readDateTime = (value: string, timeZone: string | undefined): Date | null => {
  const match = RFC3339_DATE_TIME.exec(value);
  if (!match) {
    return null;
  }
  const wallTime = readWallDateTime(match);
  if (!wallTime) {
    return null;
  }
  if (match[8]) {
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) {
      return null;
    }
    return instant;
  }
  const zone = readTimeZone(timeZone);
  if (!zone) {
    return null;
  }
  return wallTimeToInstant(wallTime, zone);
};

const readDate = (value: string): Date | null => {
  const match = RFC3339_DATE.exec(value);
  if (!match) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!isCalendarDate(year, month, day)) {
    return null;
  }
  return new Date(Date.UTC(year, month - 1, day));
};

const parseEventTime = (time?: PartialGoogleDateTime): Date | null => {
  if (time?.dateTime) {
    return readDateTime(time.dateTime, time.timeZone);
  }
  if (time?.date) {
    return readDate(time.date);
  }
  return null;
};

const parseEventDateTime = (eventTime: PartialGoogleDateTime): Date => {
  const parsed = parseEventTime(eventTime);
  if (!parsed) {
    const value = eventTime.dateTime ?? eventTime.date ?? "";
    throw new RangeError(`Google time is not a representable RFC 3339 value: ${value}`);
  }
  return parsed;
};

export { parseEventDateTime, parseEventTime };
