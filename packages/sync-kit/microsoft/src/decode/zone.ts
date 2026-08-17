import type { Instant, ZoneId } from "@keeper.sh/sync-protocol";
import type { WallTime, ZoneCache } from "@keeper.sh/sync-ical";
import {
  createZoneCache,
  instantToWallTime,
  resolveWallTime,
  resolveZoneIdentifier,
} from "@keeper.sh/sync-ical";

type ZoneReading =
  | { readonly kind: "resolved"; readonly zone: ZoneId }
  | { readonly kind: "unresolvable"; readonly identifier: string };

/*
 * Exchange reports a mailbox zone that has no CLDR name as this literal, and Graph then answers in
 * the zone the Prefer header asked for, which this adapter always pins to UTC.
 * https://learn.microsoft.com/en-us/graph/api/resources/datetimetimezone
 */
const customZoneMarker = "tzone://Microsoft/Custom";

const utcZone: ZoneId = { kind: "zoneId", value: "UTC" };

const epoch: Instant = { kind: "instant", value: "1970-01-01T00:00:00.000Z" };

const graphDateTime = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/;

const createGraphZones = (): ZoneCache => createZoneCache();

const acceptedByPlatform = (zone: ZoneId, zones: ZoneCache): boolean => {
  try {
    return instantToWallTime(epoch, zone, zones).value.length > 0;
  } catch {
    return false;
  }
};

const resolveGraphZone = (identifier: string | null, zones: ZoneCache): ZoneReading => {
  if (identifier === null || identifier.trim().length === 0) {
    return { kind: "unresolvable", identifier: identifier ?? "" };
  }
  if (identifier.trim() === customZoneMarker) {
    return { kind: "resolved", zone: utcZone };
  }
  const resolved = resolveZoneIdentifier(identifier, []);
  if (resolved.kind === "unsupported") {
    return { kind: "unresolvable", identifier };
  }
  if (!acceptedByPlatform(resolved.zone, zones)) {
    return { kind: "unresolvable", identifier };
  }
  return { kind: "resolved", zone: resolved.zone };
};

const wallTimeOf = (dateTime: string): WallTime | null => {
  const matched = graphDateTime.exec(dateTime);
  if (!matched) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = matched;
  return { kind: "wallTime", value: `${year}${month}${day}T${hour}${minute}${second}` };
};

const instantOfGraphDateTime = (
  dateTime: string,
  zone: ZoneId,
  zones: ZoneCache,
): Instant | null => {
  const wall = wallTimeOf(dateTime);
  if (wall === null) {
    return null;
  }
  return resolveWallTime(wall, zone, zones).instant;
};

const calendarDateOfGraphDateTime = (dateTime: string): string | null => {
  const matched = graphDateTime.exec(dateTime);
  if (!matched) {
    return null;
  }
  const [, year, month, day] = matched;
  return `${year}-${month}-${day}`;
};

export {
  calendarDateOfGraphDateTime,
  createGraphZones,
  customZoneMarker,
  instantOfGraphDateTime,
  resolveGraphZone,
  utcZone,
};
export type { ZoneReading };
