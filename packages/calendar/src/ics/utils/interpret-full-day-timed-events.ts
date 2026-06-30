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

const isLocalMidnightSpan = (
  event: SourceEvent,
  calendarTimeZone: string | undefined,
): boolean => {
  if (event.isAllDay || event.endTime <= event.startTime) {
    return false;
  }

  const timezone = event.startTimeZone ?? normalizeTimezone(calendarTimeZone);
  if (!timezone) {
    return false;
  }

  try {
    const startParts = partsInTimeZone(event.startTime, timezone);
    const endParts = partsInTimeZone(event.endTime, timezone);
    return (
      isMidnight(startParts)
      && isMidnight(endParts)
      && localDateKey(startParts) !== localDateKey(endParts)
    );
  } catch {
    return false;
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
    if (!isLocalMidnightSpan(event, options.calendarTimeZone)) {
      return event;
    }

    return { ...event, isAllDay: true };
  });
};

export { interpretFullDayTimedEventsAsAllDay };
export type { InterpretFullDayTimedEventsOptions };
