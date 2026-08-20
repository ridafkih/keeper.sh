import type { Instant, ZoneId } from "@keeper.sh/sync-protocol";
import { IcsInternalDataError } from "../errors";
import {
  millisecondsInMinute,
  offsetMinutesAt,
  padded,
  utcMillisecondsOf,
  wallClockFieldsAt,
} from "./offset";
import type { ZoneCache } from "./zone-cache";

interface WallTime {
  readonly kind: "wallTime";
  readonly value: string;
}

type WallTimeResolution =
  | { readonly kind: "unique"; readonly instant: Instant }
  | { readonly kind: "fold"; readonly instant: Instant; readonly discarded: Instant }
  | { readonly kind: "gap"; readonly instant: Instant; readonly shiftMinutes: number };

const bracketMs = 24 * 60 * millisecondsInMinute;
const wallTimePattern = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/u;

const instantOf = (atMs: number): Instant => ({ kind: "instant", value: new Date(atMs).toISOString() });

const wallTimeMs = (wall: WallTime): number => {
  const matched = wallTimePattern.exec(wall.value);
  if (!matched) {
    throw new IcsInternalDataError(`a wall time was built in an unreadable shape: ${wall.value}`);
  }
  const [, year, month, day, hour, minute, second] = matched;
  return utcMillisecondsOf({
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  });
};

const formatWallTime = (fields: {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}): string =>
  `${padded(fields.year, 4)}${padded(fields.month, 2)}${padded(fields.day, 2)}T${padded(fields.hour, 2)}${padded(fields.minute, 2)}${padded(fields.second, 2)}`;

const instantToWallTime = (instant: Instant, zone: ZoneId, zones: ZoneCache): WallTime => ({
  kind: "wallTime",
  value: formatWallTime(wallClockFieldsAt(zones, zone.value, Date.parse(instant.value))),
});

const isConsistent = (
  zones: ZoneCache,
  zone: ZoneId,
  localMs: number,
  candidateMs: number,
): boolean => offsetMinutesAt(zones, zone.value, candidateMs) * millisecondsInMinute === localMs - candidateMs;

const resolveWallTime = (wall: WallTime, zone: ZoneId, zones: ZoneCache): WallTimeResolution => {
  const localMs = wallTimeMs(wall);
  const before = offsetMinutesAt(zones, zone.value, localMs - bracketMs);
  const after = offsetMinutesAt(zones, zone.value, localMs + bracketMs);
  if (before === after) {
    return { kind: "unique", instant: instantOf(localMs - before * millisecondsInMinute) };
  }
  const earlierCandidate = localMs - Math.max(before, after) * millisecondsInMinute;
  const laterCandidate = localMs - Math.min(before, after) * millisecondsInMinute;
  const earlierValid = isConsistent(zones, zone, localMs, earlierCandidate);
  const laterValid = isConsistent(zones, zone, localMs, laterCandidate);
  if (earlierValid && laterValid) {
    return { kind: "fold", instant: instantOf(earlierCandidate), discarded: instantOf(laterCandidate) };
  }
  if (earlierValid) {
    return { kind: "unique", instant: instantOf(earlierCandidate) };
  }
  if (laterValid) {
    return { kind: "unique", instant: instantOf(laterCandidate) };
  }
  return {
    kind: "gap",
    instant: instantOf(laterCandidate),
    shiftMinutes: Math.abs(after - before),
  };
};

export { formatWallTime, instantOf, instantToWallTime, resolveWallTime, wallTimeMs };
export type { WallTime, WallTimeResolution };
