import type { PartialGoogleDateTime } from "../types";

const RFC3339_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;
const RFC3339_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const isCalendarDate = (year: number, month: number, day: number): boolean => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const invalidTime = (value: string): RangeError =>
  new RangeError(`Google time is not a valid RFC 3339 value: ${value}`);

const matchCalendarDate = (pattern: RegExp, value: string): [number, number, number] => {
  const match = pattern.exec(value);
  if (!match) {
    throw invalidTime(value);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isCalendarDate(year, month, day)) {
    throw invalidTime(value);
  }
  return [year, month, day];
};

const parseDateTime = (value: string): Date => {
  matchCalendarDate(RFC3339_DATE_TIME, value);
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw invalidTime(value);
  }
  return instant;
};

const parseDate = (value: string): Date => {
  const [year, month, day] = matchCalendarDate(RFC3339_DATE, value);
  return new Date(Date.UTC(year, month - 1, day));
};

const parseEventTime = (time?: PartialGoogleDateTime): Date | null => {
  if (time?.dateTime) {
    return parseDateTime(time.dateTime);
  }
  if (time?.date) {
    return parseDate(time.date);
  }
  return null;
};

const parseEventDateTime = (eventTime: PartialGoogleDateTime): Date => {
  const parsed = parseEventTime(eventTime);
  if (!parsed) {
    throw new Error("Event has no date or dateTime");
  }
  return parsed;
};

export { parseEventDateTime, parseEventTime };
