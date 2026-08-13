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

const parseIcsCalendar = (options: ParseIcsCalendarOptions) =>
  convertIcsCalendar<CalendarNonStandardValues>(
    globalThis.undefined,
    synthesizeMissingVtimezones(stripIcsByteOrderMark(options.icsString)),
    { nonStandard: CALENDAR_NON_STANDARD_VALUES },
  );

export { parseIcsCalendar };
export type { CalendarNonStandardValues };
