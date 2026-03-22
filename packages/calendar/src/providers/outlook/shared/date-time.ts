import type { OutlookDateTime, PartialOutlookDateTime } from "../types";
import { normalizeTimezone } from "../../../ics/utils/normalize-timezone";

const parseDateTimeInTimezone = (dateTime: string, timeZone: string): Date => {
  if (timeZone === "UTC" && !dateTime.endsWith("Z")) {
    return new Date(`${dateTime}Z`);
  }

  if (dateTime.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(dateTime)) {
    return new Date(dateTime);
  }

  const ianaTimezone = normalizeTimezone(timeZone) ?? timeZone;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ianaTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const dateTimeAsUtc = new Date(`${dateTime}Z`);
  const parts = formatter.formatToParts(dateTimeAsUtc);

  const getPartValue = (type: Intl.DateTimeFormatPartTypes): string => {
    const match = parts.find((part) => part.type === type);

    if (!match) {
      throw new Error(`Missing ${type} in formatted date parts for ${dateTime} (${timeZone})`);
    }

    return match.value;
  };

  const localWallTime = Date.UTC(
    Number(getPartValue("year")),
    Number(getPartValue("month")) - 1,
    Number(getPartValue("day")),
    Number(getPartValue("hour")),
    Number(getPartValue("minute")),
    Number(getPartValue("second")),
  );

  const offsetMs = localWallTime - dateTimeAsUtc.getTime();
  return new Date(dateTimeAsUtc.getTime() - offsetMs);
};

const parseEventDateTime = (eventTime: OutlookDateTime): Date =>
  parseDateTimeInTimezone(eventTime.dateTime, eventTime.timeZone);

const parseEventTime = (time: PartialOutlookDateTime | undefined): Date | null => {
  if (!time?.dateTime || !time.timeZone) {
    return null;
  }

  return parseDateTimeInTimezone(time.dateTime, time.timeZone);
};

export { parseEventDateTime, parseEventTime };
