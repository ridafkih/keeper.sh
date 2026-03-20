import type { OutlookDateTime, PartialOutlookDateTime } from "../types";
import { normalizeTimezone } from "../../../ics/utils/normalize-timezone";

const MS_PER_MINUTE = 60_000;

const timezoneFormatter = (ianaTimezone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: ianaTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

const getPartValue = (
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number => Number(parts.find((part) => part.type === type)?.value);

/**
 * Resolves the UTC offset (in minutes) for a given IANA timezone at a specific instant
 * by comparing the local wall-clock parts to the true UTC timestamp.
 */
const getTimezoneOffsetMinutes = (ianaTimezone: string, referenceDate: Date): number => {
  const parts = timezoneFormatter(ianaTimezone).formatToParts(referenceDate);

  const localAsUtcMs = Date.UTC(
    getPartValue(parts, "year"),
    getPartValue(parts, "month") - 1,
    getPartValue(parts, "day"),
    getPartValue(parts, "hour"),
    getPartValue(parts, "minute"),
    getPartValue(parts, "second"),
  );

  return (localAsUtcMs - referenceDate.getTime()) / MS_PER_MINUTE;
};

/**
 * Parses a datetime string that represents local time in the given timezone.
 * Returns a Date with the correct UTC instant.
 */
const parseDateTimeWithTimezone = (dateTimeStr: string, timeZone: string): Date => {
  if (dateTimeStr.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(dateTimeStr)) {
    return new Date(dateTimeStr);
  }

  if (timeZone === "UTC") {
    return new Date(`${dateTimeStr}Z`);
  }

  const ianaTimezone = normalizeTimezone(timeZone) ?? timeZone;
  const asUtc = new Date(`${dateTimeStr}Z`);
  const offsetMinutes = getTimezoneOffsetMinutes(ianaTimezone, asUtc);

  return new Date(asUtc.getTime() - offsetMinutes * MS_PER_MINUTE);
};

const parseEventDateTime = (eventTime: OutlookDateTime): Date =>
  parseDateTimeWithTimezone(eventTime.dateTime, eventTime.timeZone);

const parseEventTime = (time: PartialOutlookDateTime | undefined): Date | null => {
  if (!time?.dateTime) {
    return null;
  }

  const timeZone = time.timeZone ?? "UTC";
  return parseDateTimeWithTimezone(time.dateTime, timeZone);
};

export { parseEventDateTime, parseEventTime };
