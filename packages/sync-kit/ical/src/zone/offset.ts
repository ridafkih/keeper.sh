import type { Instant, ZoneId } from "@keeper.sh/sync-protocol";
import { IcsInternalDataError } from "../errors";
import type { ZoneCache } from "./zone-cache";
import { wallClockFormatter } from "./zone-cache";

const millisecondsInMinute = 60_000;
const minutesInHour = 60;
const renderedWallClock = /^(-?\d{1,6})-(\d{2})-(\d{2})[ ,T]+(\d{2}):(\d{2}):(\d{2})$/u;

interface WallClockFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const isoLikeWallClock = (rendered: string): boolean =>
  rendered.length === 19 && rendered[4] === "-" && rendered[10] === " " && rendered[13] === ":";

const slicedWallClock = (rendered: string): WallClockFields => ({
  year: Number(rendered.slice(0, 4)),
  month: Number(rendered.slice(5, 7)),
  day: Number(rendered.slice(8, 10)),
  hour: Number(rendered.slice(11, 13)),
  minute: Number(rendered.slice(14, 16)),
  second: Number(rendered.slice(17, 19)),
});

const matchedWallClock = (rendered: string): WallClockFields => {
  const matched = renderedWallClock.exec(rendered.trim());
  if (!matched) {
    throw new IcsInternalDataError(`the platform rendered an unreadable wall clock: ${rendered}`);
  }
  const [, year, month, day, hour, minute, second] = matched;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
};

const readWallClock = (rendered: string): WallClockFields => {
  if (isoLikeWallClock(rendered)) {
    return slicedWallClock(rendered);
  }
  return matchedWallClock(rendered);
};

const wallClockFieldsAt = (zones: ZoneCache, zoneValue: string, atMs: number): WallClockFields =>
  readWallClock(wallClockFormatter(zones, zoneValue).format(atMs));

const utcMillisecondsOf = (fields: WallClockFields): number => {
  const at = new Date(0);
  at.setUTCFullYear(fields.year, fields.month - 1, fields.day);
  at.setUTCHours(fields.hour, fields.minute, fields.second, 0);
  return at.getTime();
};

const offsetMinutesAt = (zones: ZoneCache, zoneValue: string, atMs: number): number => {
  zones.counters.offsetProbes += 1;
  return Math.round(
    (utcMillisecondsOf(wallClockFieldsAt(zones, zoneValue, atMs)) - atMs) / millisecondsInMinute,
  );
};

const zoneOffsetMinutes = (instant: Instant, zone: ZoneId, zones: ZoneCache): number =>
  offsetMinutesAt(zones, zone.value, Date.parse(instant.value));

const padded = (value: number, width: number): string => String(value).padStart(width, "0");

const formatUtcOffset = (offsetMinutes: number): string => {
  if (!Number.isInteger(offsetMinutes)) {
    throw new IcsInternalDataError(`an offset of ${offsetMinutes} minutes cannot be written as ±HHMM`);
  }
  const magnitude = Math.abs(offsetMinutes);
  const hours = Math.floor(magnitude / minutesInHour);
  const minutes = magnitude % minutesInHour;
  if (offsetMinutes < 0) {
    return `-${padded(hours, 2)}${padded(minutes, 2)}`;
  }
  return `+${padded(hours, 2)}${padded(minutes, 2)}`;
};

const parseUtcOffset = (text: string): number | null => {
  const matched = /^([+-])(\d{2})(\d{2})(\d{2})?$/u.exec(text.trim());
  if (!matched) {
    return null;
  }
  const [, sign, hours, minutes, seconds] = matched;
  const magnitude = Number(hours) * minutesInHour + Number(minutes) + Number(seconds ?? 0) / 60;
  if (sign === "-") {
    return -magnitude;
  }
  return magnitude;
};

export {
  formatUtcOffset,
  millisecondsInMinute,
  minutesInHour,
  offsetMinutesAt,
  padded,
  parseUtcOffset,
  utcMillisecondsOf,
  wallClockFieldsAt,
  zoneOffsetMinutes,
};
export type { WallClockFields };
