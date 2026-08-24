import { convertIcsCalendar } from "ts-ics";
import type { IcsCalendar, IcsTimezone, Line, ParseNonStandardValues } from "ts-ics";
import { stripIcsByteOrderMark } from "./apply-patches";
import { detachProjectedVtimezones } from "./detach-projected-vtimezones";
import { resolveCalendarZonedInstants } from "./resolve-zoned-instants";
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

const parseProjectedTimezones = (blocks: string[]): IcsTimezone[] => {
  if (blocks.length === 0) {
    return [];
  }
  const timezoneOnlyCalendar = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Keeper//Keeper Calendar//EN",
    ...blocks,
    "END:VCALENDAR",
  ].join("\r\n");
  return convertIcsCalendar(globalThis.undefined, timezoneOnlyCalendar).timezones ?? [];
};

const withProjectedTimezones = (
  calendar: IcsCalendar<CalendarNonStandardValues>,
  blocks: string[],
): IcsCalendar<CalendarNonStandardValues> => {
  const projected = parseProjectedTimezones(blocks);
  if (projected.length === 0) {
    return calendar;
  }
  return { ...calendar, timezones: [...projected, ...calendar.timezones ?? []] };
};

/*
 * A body that never opened a VCALENDAR is unreadable, not empty; parsing it
 * into zero events would read downstream as "delete everything".
 */
const parseIcsCalendar = (options: ParseIcsCalendarOptions) => {
  const icsString = synthesizeMissingVtimezones(stripIcsByteOrderMark(options.icsString));
  if (!CALENDAR_BEGIN_PATTERN.test(icsString)) {
    throw new Error("Not an iCalendar document: no BEGIN:VCALENDAR line");
  }
  const detached = detachProjectedVtimezones(icsString);
  const calendar = convertIcsCalendar<CalendarNonStandardValues>(
    globalThis.undefined,
    detached.icsString,
    { nonStandard: CALENDAR_NON_STANDARD_VALUES },
  );
  return resolveCalendarZonedInstants(
    withProjectedTimezones(calendar, detached.projectedBlocks),
  );
};

export { parseIcsCalendar };
export type { CalendarNonStandardValues };
