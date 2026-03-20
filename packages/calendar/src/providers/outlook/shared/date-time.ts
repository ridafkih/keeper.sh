import type { OutlookDateTime, PartialOutlookDateTime } from "../types";
import { normalizeTimezone } from "../../../ics/utils/normalize-timezone";

const MS_PER_MINUTE = 60_000;

/**
 * Resolves the UTC offset (in minutes) for a given IANA timezone at a specific instant.
 * Uses Intl.DateTimeFormat to extract the offset from the formatted output.
 */
const getTimezoneOffsetMinutes = (ianaTimezone: string, referenceDate: Date): number => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ianaTimezone,
    timeZoneName: "longOffset",
  });

  const parts = formatter.formatToParts(referenceDate);
  const tzPart = parts.find((part) => part.type === "timeZoneName");

  if (!tzPart?.value) {
    return 0;
  }

  // Format is "GMT", "GMT+7", "GMT+05:30", "GMT-8", etc.
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(tzPart.value);

  if (!match) {
    return 0;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number.parseInt(match[2], 10);
  const minutes = match[3] ? Number.parseInt(match[3], 10) : 0;

  return sign * (hours * 60 + minutes);
};

/**
 * Parses a datetime string that represents local time in the given timezone.
 * Returns a Date with the correct UTC instant.
 */
const parseDateTimeWithTimezone = (dateTimeStr: string, timeZone: string): Date => {
  // If the string already has timezone info (ends with Z or has offset), parse directly
  if (dateTimeStr.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(dateTimeStr)) {
    return new Date(dateTimeStr);
  }

  if (timeZone === "UTC") {
    return new Date(`${dateTimeStr}Z`);
  }

  const ianaTimezone = normalizeTimezone(timeZone) ?? timeZone;

  // Parse as UTC first to get a reference point for offset calculation
  const asUtc = new Date(`${dateTimeStr}Z`);

  // Get the timezone offset at this approximate instant
  const offsetMinutes = getTimezoneOffsetMinutes(ianaTimezone, asUtc);

  // Subtract the offset to convert from local time to UTC
  // e.g., timezone UTC+7, local 11:00 → UTC 04:00 (subtract 7 hours)
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
