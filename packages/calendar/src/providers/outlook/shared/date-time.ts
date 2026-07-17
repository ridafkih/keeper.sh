import type { OutlookDateTime, PartialOutlookDateTime } from "../types";
import { resolveTimeZone, wallTimeToInstant } from "../../../ics/utils/timezone-instant";

const EXPLICIT_OFFSET_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/i;
const WALL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/;

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

const parseEventTime = (time: PartialOutlookDateTime | undefined): Date | null => {
  if (!time?.dateTime) {
    return null;
  }

  if (!time.timeZone) {
    return new Date(time.dateTime);
  }
  return parseEventDateTime({ dateTime: time.dateTime, timeZone: time.timeZone });
};

export { parseEventDateTime, parseEventTime };
