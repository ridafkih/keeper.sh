import { convertIcsCalendar } from "ts-ics";
import type { Line, ParseNonStandardValues } from "ts-ics";
import { stripIcsByteOrderMark } from "./apply-patches";
import { synthesizeMissingVtimezones } from "./synthesize-vtimezones";

interface CalendarNonStandardValues {
  wrTimezone?: string;
}

interface ParseIcsCalendarOptions {
  icsString: string;
}

const parseTextLine = (line: Line): string => line.value;

const CALENDAR_NON_STANDARD_VALUES: ParseNonStandardValues<CalendarNonStandardValues> = {
  wrTimezone: {
    name: "X-WR-TIMEZONE",
    convert: parseTextLine,
  },
};

const CALENDAR_BEGIN_PATTERN = /(?:^|[\r\n])BEGIN:VCALENDAR[ \t]*(?:[\r\n]|$)/i;

/*
 * A body that never opened a VCALENDAR is unreadable, not empty; parsing it
 * into zero events would read downstream as "delete everything".
 */
const parseIcsCalendar = (options: ParseIcsCalendarOptions) => {
  const icsString = synthesizeMissingVtimezones(stripIcsByteOrderMark(options.icsString));
  if (!CALENDAR_BEGIN_PATTERN.test(icsString)) {
    throw new Error("Not an iCalendar document: no BEGIN:VCALENDAR line");
  }
  return convertIcsCalendar<CalendarNonStandardValues>(
    globalThis.undefined,
    icsString,
    { nonStandard: CALENDAR_NON_STANDARD_VALUES },
  );
};

export { parseIcsCalendar };
export type { CalendarNonStandardValues };
