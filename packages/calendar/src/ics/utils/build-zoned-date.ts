import type { IcsDateObject } from "ts-ics";
import { normalizeTimezone } from "./normalize-timezone";

const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = 60 * 1000;
const HOURS_IN_DAY = 24;

interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

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

  // Intl can report midnight as hour "24"; normalize it back to 0.
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

const padTwo = (value: number): string => value.toString().padStart(2, "0");

/**
 * Format a millisecond offset (wall-clock minus instant) as an RFC 5545 / ISO
 * style `±HH:MM` string, e.g. -10800000 → "-03:00".
 */
const formatTzOffset = (offsetMs: number): string => {
  let sign = "+";
  if (offsetMs < 0) {
    sign = "-";
  }
  const totalMinutes = Math.round(Math.abs(offsetMs) / MS_PER_MINUTE);
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  return `${sign}${padTwo(hours)}:${padTwo(minutes)}`;
};

/**
 * Build a ts-ics `IcsDateObject` for a DTSTART/DTEND value, attaching the
 * calendar-local timezone when one is known.
 *
 * - All-day events stay timezone-less (`{ date, type: "DATE" }`).
 * - Timed events with a known IANA timezone get a `local` block so the
 *   generator emits `DTSTART;TZID=<tz>:<local-wall-clock>` instead of a bare
 *   UTC `...Z` value. The read side mirrors this via `event.start.local`.
 * - Timed events without a timezone (or with an unresolvable one) fall back to
 *   a bare UTC datetime, preserving the previous behavior.
 *
 * The stored instant (`date`) is never shifted; only the emitted representation
 * changes.
 */
const buildZonedIcsDate = (
  instant: Date,
  timezone: string | undefined,
  isAllDay: boolean,
): IcsDateObject => {
  if (isAllDay) {
    return { date: instant, type: "DATE" };
  }

  const resolved = normalizeTimezone(timezone);
  if (!resolved) {
    return { date: instant };
  }

  try {
    const parts = partsInTimeZone(instant, resolved);
    const localDate = new Date(
      Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second),
    );
    const offsetMs = localDate.getTime() - instant.getTime();

    return {
      date: instant,
      local: {
        date: localDate,
        timezone: resolved,
        tzoffset: formatTzOffset(offsetMs),
      },
    };
  } catch {
    // Unknown/invalid timezone — fall back to a bare UTC datetime.
    return { date: instant };
  }
};

export { buildZonedIcsDate, formatTzOffset };
