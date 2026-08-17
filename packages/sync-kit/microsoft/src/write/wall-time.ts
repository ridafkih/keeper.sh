import type { Instant, ZoneId } from "@keeper.sh/sync-protocol";
import type { WallTime, ZoneCache } from "@keeper.sh/sync-ical";
import { instantToWallTime, resolveWallTime } from "@keeper.sh/sync-ical";
import type { DateTimeTimeZone } from "@microsoft/microsoft-graph-types";

const utcZoneName = "UTC";

const utcZone: ZoneId = { kind: "zoneId", value: utcZoneName };

const wallTimeShape = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/;

const graphDateTimeOf = (wall: WallTime): string => {
  const matched = wallTimeShape.exec(wall.value);
  if (!matched) {
    throw new Error(`a wall time was built in a shape Graph cannot carry: ${wall.value}`);
  }
  const [, year, month, day, hour, minute, second] = matched;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.0000000`;
};

const roundTrips = (instant: Instant, zone: ZoneId, zones: ZoneCache): boolean => {
  const wall = instantToWallTime(instant, zone, zones);
  return resolveWallTime(wall, zone, zones).instant.value === instant.value;
};

const emittedIn = (instant: Instant, zone: ZoneId, zones: ZoneCache): DateTimeTimeZone => ({
  dateTime: graphDateTimeOf(instantToWallTime(instant, zone, zones)),
  timeZone: zone.value,
});

const emittableDateTime = (
  instant: Instant,
  zone: ZoneId | null,
  zones: ZoneCache,
): DateTimeTimeZone => {
  if (zone === null) {
    return emittedIn(instant, utcZone, zones);
  }
  if (!roundTrips(instant, zone, zones)) {
    return emittedIn(instant, utcZone, zones);
  }
  return emittedIn(instant, zone, zones);
};

export { emittableDateTime, graphDateTimeOf, roundTrips, utcZone, utcZoneName };
