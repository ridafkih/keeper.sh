import { convertIcsCalendar } from "ts-ics";
import type { Line, ParseNonStandardValues } from "ts-ics";

interface CalendarNonStandardValues {
  altDescription?: string;
}

interface ParseIcsCalendarOptions {
  icsString: string;
}

const parseTextLine = (line: Line): string => line.value;

const CALENDAR_NON_STANDARD_VALUES: ParseNonStandardValues<CalendarNonStandardValues> = {
  altDescription: {
    name: "X-ALT-DESC",
    convert: parseTextLine,
  },
};

const parseIcsCalendar = (options: ParseIcsCalendarOptions) =>
  convertIcsCalendar<CalendarNonStandardValues>(globalThis.undefined, options.icsString, {
    nonStandard: CALENDAR_NON_STANDARD_VALUES,
  });

export { parseIcsCalendar };
export type { CalendarNonStandardValues };
