import { convertIcsCalendar } from "ts-ics";
import type { Line, ParseNonStandardValues } from "ts-ics";
import { stripIcsByteOrderMark } from "./apply-patches";
import { extractVtimezones } from "./extract-vtimezones";
import { resolveCalendarZonedInstants } from "./resolve-zoned-instants";

interface CalendarNonStandardValues {
  busyStatus?: string;
  wrTimezone?: string;
  color?: string;
  appleCalendarColor?: string;
}

interface ParseIcsCalendarOptions {
  icsString: string;
}

const parseTextLine = (line: Line): string => line.value;

const CALENDAR_NON_STANDARD_VALUES: ParseNonStandardValues<CalendarNonStandardValues> = {
  busyStatus: {
    name: "X-MICROSOFT-CDO-BUSYSTATUS",
    convert: parseTextLine,
  },
  wrTimezone: {
    name: "X-WR-TIMEZONE",
    convert: parseTextLine,
  },
  color: {
    name: "X-COLOR",
    convert: parseTextLine,
  },
  appleCalendarColor: {
    name: "X-APPLE-CALENDAR-COLOR",
    convert: parseTextLine,
  },
};

/*
 * Only X-prefixed properties reach ts-ics's nonStandard bag, so RFC 7986 COLOR would be dropped.
 * Property names start a physical line, so folded continuations cannot match.
 */
const prefixRfc7986ColorProperties = (icsString: string): string =>
  icsString.replaceAll(/(^|[\r\n])COLOR(?=[;:])/gi, "$1X-COLOR");

const CALENDAR_BEGIN_PATTERN = /(?:^|[\r\n])BEGIN:VCALENDAR[ \t]*(?:[\r\n]|$)/i;

/*
 * A body that never opened a VCALENDAR is unreadable, not empty; parsing it
 * into zero events would read downstream as "delete everything".
 */
const parseIcsCalendar = (options: ParseIcsCalendarOptions) => {
  const icsString = prefixRfc7986ColorProperties(stripIcsByteOrderMark(options.icsString));
  if (!CALENDAR_BEGIN_PATTERN.test(icsString)) {
    throw new Error("Not an iCalendar document: no BEGIN:VCALENDAR line");
  }
  const extracted = extractVtimezones(icsString);
  const calendar = convertIcsCalendar<CalendarNonStandardValues>(
    globalThis.undefined,
    extracted.icsString,
    { nonStandard: CALENDAR_NON_STANDARD_VALUES },
  );
  return resolveCalendarZonedInstants(calendar, extracted.blocksByTimeZoneId);
};

export { parseIcsCalendar };
export type { CalendarNonStandardValues };
