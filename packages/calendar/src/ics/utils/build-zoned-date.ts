import type { IcsDateObject } from "ts-ics";
import { normalizeTimezone } from "./normalize-timezone";
import {
  instantToWallTime,
  isSupportedTimeZone,
  wallTimeToInstant,
} from "./timezone-instant";

const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = 60 * 1000;

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
  if (!resolved || !isSupportedTimeZone(resolved)) {
    return { date: instant };
  }

  const localDate = instantToWallTime(instant, resolved);
  // RFC 5545 cannot name which pass of a repeated fall-back hour is meant, so write UTC instead.
  if (wallTimeToInstant(localDate, resolved).getTime() !== instant.getTime()) {
    return { date: instant };
  }

  return {
    date: instant,
    local: {
      date: localDate,
      timezone: resolved,
      tzoffset: formatTzOffset(localDate.getTime() - instant.getTime()),
    },
  };
};

export { buildZonedIcsDate, formatTzOffset };
