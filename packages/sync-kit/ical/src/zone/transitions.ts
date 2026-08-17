import type { Instant, TimeWindow, ZoneId } from "@keeper.sh/sync-protocol";
import type { IcsLimits } from "../options";
import { millisecondsInMinute, offsetMinutesAt } from "./offset";
import { instantOf } from "./wall-time";
import type { ZoneCache } from "./zone-cache";

const scanStepMs = 16 * 24 * 60 * millisecondsInMinute;

const transitionBetween = (zones: ZoneCache, zone: ZoneId, beforeMs: number, afterMs: number): number => {
  const target = offsetMinutesAt(zones, zone.value, afterMs);
  const narrow = (low: number, high: number): number => {
    if (high - low <= millisecondsInMinute) {
      return high;
    }
    const middle = low + Math.floor((high - low) / (2 * millisecondsInMinute)) * millisecondsInMinute;
    if (middle === low) {
      return high;
    }
    if (offsetMinutesAt(zones, zone.value, middle) === target) {
      return narrow(low, middle);
    }
    return narrow(middle, high);
  };
  return narrow(beforeMs, afterMs);
};

const scanPointsBetween = (startMs: number, endMs: number): readonly number[] => {
  const steps = Math.max(0, Math.ceil((endMs - startMs) / scanStepMs));
  return Array.from({ length: steps }, (unused, step) =>
    Math.min(startMs + (step + 1) * scanStepMs, endMs));
};

const clampedEndMs = (startMs: number, endMs: number, limits: IcsLimits): number => {
  const at = new Date(startMs);
  at.setUTCFullYear(at.getUTCFullYear() + limits.zoneProjectionYears);
  return Math.min(endMs, at.getTime());
};

const findZoneTransitions = (
  zone: ZoneId,
  window: TimeWindow,
  zones: ZoneCache,
  limits: IcsLimits,
): readonly Instant[] => {
  const startMs = Date.parse(window.start.value);
  const endMs = clampedEndMs(startMs, Date.parse(window.end.value), limits);
  const found: Instant[] = [];
  const scan = { cursor: startMs, offset: offsetMinutesAt(zones, zone.value, startMs) };
  for (const next of scanPointsBetween(startMs, endMs)) {
    const nextOffset = offsetMinutesAt(zones, zone.value, next);
    if (nextOffset !== scan.offset) {
      found.push(instantOf(transitionBetween(zones, zone, scan.cursor, next)));
    }
    scan.cursor = next;
    scan.offset = nextOffset;
  }
  return found;
};

export { findZoneTransitions };
