import type { IcsDateObject, IcsExceptionDates, IcsRecurrenceRule } from "ts-ics";
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
  timezone: string,
): Pick<SourceEvent, "endTime" | "startTime"> | null => {
  if (event.isAllDay || event.endTime <= event.startTime) {
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

const reanchorToUtcDay = (instant: Date, timeZone: string): Date => {
  if (Number.isNaN(instant.getTime())) {
    return instant;
  }

  return utcMidnight(partsInTimeZone(instant, timeZone));
};

const reanchorDateObject = (value: IcsDateObject, timeZone: string): IcsDateObject => ({
  ...value,
  date: reanchorToUtcDay(value.date, timeZone),
});

const reanchorExceptionDates = (
  exceptionDates: IcsExceptionDates,
  timeZone: string,
): IcsExceptionDates =>
  exceptionDates.map((exceptionDate) => reanchorDateObject(exceptionDate, timeZone));

const reanchorRecurrenceRule = (
  recurrenceRule: IcsRecurrenceRule,
  timeZone: string,
): IcsRecurrenceRule => ({
  ...recurrenceRule,
  ...(recurrenceRule.until && { until: reanchorDateObject(recurrenceRule.until, timeZone) }),
});

interface InterpretedSpan {
  span: Pick<SourceEvent, "endTime" | "startTime">;
  timeZone: string;
}

// EXDATE, RECURRENCE-ID and UNTIL are matched by exact instant, so they must be re-anchored with the range.
const interpretFullDayTimedEventsAsAllDay = (
  events: SourceEvent[],
  options: InterpretFullDayTimedEventsOptions,
): SourceEvent[] => {
  if (!options.enabled) {
    return events;
  }

  const interpretedSpans = new Map<SourceEvent, InterpretedSpan>();
  const seriesTimeZones = new Map<string, string>();
  for (const event of events) {
    const timeZone = event.startTimeZone ?? normalizeTimezone(options.calendarTimeZone);
    if (!timeZone) {
      continue;
    }

    const span = resolveInterpretedAllDaySpan(event, timeZone);
    if (!span) {
      continue;
    }

    interpretedSpans.set(event, { span, timeZone });
    if (!event.recurrenceId) {
      seriesTimeZones.set(event.uid, timeZone);
    }
  }

  return events.map((event) => {
    const interpreted = interpretedSpans.get(event);
    const seriesTimeZone = event.recurrenceId && seriesTimeZones.get(event.uid);
    if (!interpreted && !seriesTimeZone) {
      return event;
    }

    return {
      ...event,
      ...(event.recurrenceId && seriesTimeZone && {
        recurrenceId: reanchorToUtcDay(event.recurrenceId, seriesTimeZone),
      }),
      // Dropping startTimeZone is required: expansion walks its wall clock and would re-introduce DST drift.
      ...(interpreted && {
        ...interpreted.span,
        isAllDay: true,
        startTimeZone: globalThis.undefined,
        ...(event.exceptionDates && {
          exceptionDates: reanchorExceptionDates(event.exceptionDates, interpreted.timeZone),
        }),
        ...(event.recurrenceRule && {
          recurrenceRule: reanchorRecurrenceRule(event.recurrenceRule, interpreted.timeZone),
        }),
      }),
    };
  });
};

export { interpretFullDayTimedEventsAsAllDay };
export type { InterpretFullDayTimedEventsOptions };
