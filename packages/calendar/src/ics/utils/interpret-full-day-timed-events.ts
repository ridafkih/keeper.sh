import type { SourceEvent } from "../../core/types";
import { normalizeTimezone } from "./normalize-timezone";

interface InterpretFullDayTimedEventsOptions {
  calendarTimeZone?: string;
  enabled: boolean;
}

interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const HOURS_IN_DAY = 24;

const partsInTimeZone = (instant: Date, timeZone: string): WallClockParts => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const lookup = new Map<string, string>();
  for (const part of formatter.formatToParts(instant)) {
    lookup.set(part.type, part.value);
  }

  const read = (type: string): number => Number.parseInt(lookup.get(type) ?? "0", 10);
  let hour = read("hour");
  if (hour === HOURS_IN_DAY) {
    hour = 0;
  }

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour,
    minute: read("minute"),
    second: read("second"),
  };
};

const isMidnight = (parts: WallClockParts): boolean =>
  parts.hour === 0 && parts.minute === 0 && parts.second === 0;

const localDateKey = (parts: WallClockParts): string =>
  `${parts.year}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;

const utcMidnight = (parts: WallClockParts): Date =>
  new Date(Date.UTC(parts.year, parts.month - 1, parts.day));

/*
 * Every destination reads an all-day instant as UTC midnight: Outlook emits the
 * bare UTC wall time, Google and CalDAV take the UTC date. Leaving the event on
 * its local-midnight instant would therefore write a wrong value that Keeper
 * cannot read back, so each run would see drift and delete-and-recreate the
 * event forever. Anchoring on the local calendar day expressed as UTC midnight
 * gives the interpreted event the same shape as a plain VALUE=DATE one.
 */
const resolveInterpretedAllDaySpan = (
  event: SourceEvent,
  calendarTimeZone: string | undefined,
): Pick<SourceEvent, "endTime" | "startTime"> | null => {
  if (event.isAllDay || event.endTime <= event.startTime) {
    return null;
  }

  const timezone = event.startTimeZone ?? normalizeTimezone(calendarTimeZone);
  if (!timezone) {
    return null;
  }

  try {
    const startParts = partsInTimeZone(event.startTime, timezone);
    const endParts = partsInTimeZone(event.endTime, timezone);
    if (
      !isMidnight(startParts)
      || !isMidnight(endParts)
      || localDateKey(startParts) === localDateKey(endParts)
    ) {
      return null;
    }

    return { endTime: utcMidnight(endParts), startTime: utcMidnight(startParts) };
  } catch {
    return null;
  }
};

const interpretFullDayTimedEventsAsAllDay = (
  events: SourceEvent[],
  options: InterpretFullDayTimedEventsOptions,
): SourceEvent[] => {
  if (!options.enabled) {
    return events;
  }

  return events.map((event) => {
    const span = resolveInterpretedAllDaySpan(event, options.calendarTimeZone);
    if (!span) {
      return event;
    }

    /*
     * The originating timezone is dropped along with the times it described.
     * Recurrence expansion walks wall clock in `startTimeZone`, so keeping it
     * would re-introduce an hour of drift on every occurrence past a DST
     * transition, pushing those occurrences back off UTC midnight.
     */
    return { ...event, ...span, isAllDay: true, startTimeZone: globalThis.undefined };
  });
};

export { interpretFullDayTimedEventsAsAllDay };
export type { InterpretFullDayTimedEventsOptions };
