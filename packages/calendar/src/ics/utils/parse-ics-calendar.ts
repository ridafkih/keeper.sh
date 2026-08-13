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
 * An empty body parses into an object with no events, which every caller reads
 * as "this calendar has nothing in it" and acts on by deleting stored state. A
 * body that never opened a VCALENDAR is an unreadable resource, not an empty
 * one, and has to fail where unreadable resources are already counted.
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
