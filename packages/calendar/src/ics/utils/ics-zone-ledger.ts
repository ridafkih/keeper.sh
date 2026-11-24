import type { IcsDateObject, IcsTimezone } from "ts-ics";
import { buildZoneVtimezone } from "./build-vtimezone";
import { buildZonedIcsDate } from "./build-zoned-date";
import { canonicalizeTimeZone } from "./canonical-time-zone";

type TimeZoneInput = string | null | undefined;

interface IcsZoneLedger {
  writeDate: (instant: Date, timeZone: TimeZoneInput, isAllDay: boolean) => IcsDateObject;
  resolveWrittenTimeZone: (instant: Date, timeZone: TimeZoneInput) => string | undefined;
  buildTimezones: () => IcsTimezone[];
}

const createIcsZoneLedger = (): IcsZoneLedger => {
  const earliestInstantByTimeZone = new Map<string, Date>();

  const recordTimeZone = (timeZone: string, instant: Date): void => {
    const earliest = earliestInstantByTimeZone.get(timeZone);
    if (!earliest || instant < earliest) {
      earliestInstantByTimeZone.set(timeZone, instant);
    }
  };

  const writeDate = (instant: Date, timeZone: TimeZoneInput, isAllDay: boolean): IcsDateObject => {
    const date = buildZonedIcsDate(instant, canonicalizeTimeZone(timeZone), isAllDay);
    if (date.local) {
      recordTimeZone(date.local.timezone, instant);
    }
    return date;
  };

  const resolveWrittenTimeZone = (instant: Date, timeZone: TimeZoneInput): string | undefined =>
    buildZonedIcsDate(instant, canonicalizeTimeZone(timeZone), false).local?.timezone;

  const buildTimezones = (): IcsTimezone[] =>
    [...earliestInstantByTimeZone].map(([timeZone, reference]) => buildZoneVtimezone(timeZone, reference));

  return { buildTimezones, resolveWrittenTimeZone, writeDate };
};

export { createIcsZoneLedger };
export type { IcsZoneLedger };
