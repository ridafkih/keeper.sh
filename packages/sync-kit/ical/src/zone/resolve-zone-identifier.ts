import type { ZoneId } from "@keeper.sh/sync-protocol";
import { isKnownToPlatform, windowsMapping } from "./normalize-zone-id";
import { minutesInHour } from "./offset";
import type { DeclaredZone } from "./vtimezone";

const zoneResolutionRungs = [
  "ianaDirect",
  "windowsCldr",
  "embeddedIanaSegment",
  "declaredFixedOffset",
] as const;
type ZoneResolutionRung = (typeof zoneResolutionRungs)[number];

const zoneRefusals = ["unknownIdentifier", "declaredZoneChangesOffset", "subMinuteOffset"] as const;
type ZoneRefusal = (typeof zoneRefusals)[number];

type ZoneResolution =
  | { readonly kind: "resolved"; readonly zone: ZoneId; readonly via: ZoneResolutionRung }
  | { readonly kind: "unsupported"; readonly identifier: string; readonly reason: ZoneRefusal };

const resolvedAs = (value: string, via: ZoneResolutionRung): ZoneResolution => ({
  kind: "resolved",
  zone: { kind: "zoneId", value },
  via,
});

const embeddedIanaSegment = (identifier: string): string | null => {
  const segments = identifier.split("/").filter((segment) => segment.length > 0);
  const candidates = [3, 2]
    .filter((width) => width <= segments.length)
    .map((width) => segments.slice(segments.length - width).join("/"));
  return candidates.find((candidate) => isKnownToPlatform(candidate)) ?? null;
};

const fixedOffsetZone = (offsetMinutes: number): string | null => {
  if (offsetMinutes % minutesInHour !== 0) {
    return null;
  }
  const hours = offsetMinutes / minutesInHour;
  if (hours === 0) {
    return "UTC";
  }
  if (hours < 0) {
    return `Etc/GMT+${Math.abs(hours)}`;
  }
  return `Etc/GMT-${hours}`;
};

const fromDeclaredZone = (declared: DeclaredZone): ZoneResolution => {
  if (declared.offsets.some((offset) => !Number.isInteger(offset))) {
    return { kind: "unsupported", identifier: declared.declaredId, reason: "subMinuteOffset" };
  }
  const distinct = [...new Set(declared.offsets)];
  const [only] = distinct;
  if (distinct.length !== 1 || typeof only !== "number") {
    return { kind: "unsupported", identifier: declared.declaredId, reason: "declaredZoneChangesOffset" };
  }
  const flattened = fixedOffsetZone(only);
  if (!flattened) {
    return { kind: "unsupported", identifier: declared.declaredId, reason: "unknownIdentifier" };
  }
  return resolvedAs(flattened, "declaredFixedOffset");
};

const resolveZoneIdentifier = (
  identifier: string,
  declared: readonly DeclaredZone[],
): ZoneResolution => {
  const trimmed = identifier.trim();
  if (isKnownToPlatform(trimmed)) {
    return resolvedAs(trimmed, "ianaDirect");
  }
  const windows = windowsMapping(trimmed);
  if (windows) {
    return resolvedAs(windows, "windowsCldr");
  }
  const embedded = embeddedIanaSegment(trimmed);
  if (embedded) {
    return resolvedAs(embedded, "embeddedIanaSegment");
  }
  const declaration = declared.find((candidate) => candidate.declaredId === trimmed);
  if (declaration) {
    return fromDeclaredZone(declaration);
  }
  return { kind: "unsupported", identifier: trimmed, reason: "unknownIdentifier" };
};

export { resolveZoneIdentifier, zoneRefusals, zoneResolutionRungs };
export type { ZoneRefusal, ZoneResolution, ZoneResolutionRung };
