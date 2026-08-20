import type { Instant, ZoneId } from "@keeper.sh/sync-protocol";
import { instantToWallTime, resolveWallTime } from "../zone/wall-time";
import type { ZoneCache } from "../zone/zone-cache";

type ZonedDateRendering =
  | { readonly kind: "localWithTzid"; readonly text: string }
  | { readonly kind: "utc"; readonly text: string };

const utcText = (instant: Instant): string => {
  const at = new Date(instant.value);
  return `${at.toISOString().slice(0, 19).replaceAll("-", "").replaceAll(":", "")}Z`;
};

const renderZonedDate = (
  name: string,
  instant: Instant,
  zone: ZoneId,
  zones: ZoneCache,
): ZonedDateRendering => {
  const wall = instantToWallTime(instant, zone, zones);
  const resolved = resolveWallTime(wall, zone, zones);
  if (resolved.instant.value === instant.value) {
    return { kind: "localWithTzid", text: `${name};TZID=${zone.value}:${wall.value}` };
  }
  return { kind: "utc", text: `${name}:${utcText(instant)}` };
};

const serialiseZonedDate = (instant: Instant, zone: ZoneId, zones: ZoneCache): ZonedDateRendering =>
  renderZonedDate("DTSTART", instant, zone, zones);

export { renderZonedDate, serialiseZonedDate, utcText };
export type { ZonedDateRendering };
