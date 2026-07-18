import type { OutlookDateTime, PartialOutlookDateTime } from "../types";
import { resolveTimeZone, wallTimeToInstant } from "../../../ics/utils/timezone-instant";

const EXPLICIT_OFFSET_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/i;
const WALL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/;
const DATE_PREFIX_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/;

const parseWallDateTime = (value: string): Date => {
  const match = WALL_DATE_TIME_PATTERN.exec(value);
  if (!match) {
    throw new RangeError(`Invalid Outlook dateTime: ${value}`);
  }
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const milliseconds = Number(`0.${fraction || "0"}`) * 1000;
  return new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    milliseconds,
  ));
};

const parseEventDateTime = (eventTime: OutlookDateTime): Date => {
  if (EXPLICIT_OFFSET_PATTERN.test(eventTime.dateTime)) {
    return new Date(eventTime.dateTime);
  }

  const timeZone = resolveTimeZone(eventTime.timeZone);
  if (!timeZone) {
    throw new RangeError("Outlook event is missing a timezone");
  }
  return wallTimeToInstant(parseWallDateTime(eventTime.dateTime), timeZone);
};

const parseAllDayEventTime = (time: PartialOutlookDateTime | undefined): Date | null => {
  if (!time?.dateTime) {
    return null;
  }
  const match = DATE_PREFIX_PATTERN.exec(time.dateTime);
  if (!match) {
    throw new RangeError(`Invalid Outlook all-day dateTime: ${time.dateTime}`);
  }
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() !== Number(month) - 1
    || date.getUTCDate() !== Number(day)
  ) {
    throw new RangeError(`Invalid Outlook all-day dateTime: ${time.dateTime}`);
  }
  return date;
};

const parseEventTime = (
  time: PartialOutlookDateTime | undefined,
  isAllDay = false,
): Date | null => {
  if (!time?.dateTime) {
    return null;
  }

  if (isAllDay) {
    return parseAllDayEventTime(time);
  }

  if (!time.timeZone) {
    return new Date(time.dateTime);
  }
  return parseEventDateTime({ dateTime: time.dateTime, timeZone: time.timeZone });
};

export { parseAllDayEventTime, parseEventDateTime, parseEventTime };
