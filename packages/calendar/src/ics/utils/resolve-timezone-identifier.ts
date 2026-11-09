import { visitIcsProperties } from "./apply-patches";
import { canFormatTimeZone, listSupportedTimeZones, readTimeZoneOffsetMinutes } from "./intl-time-zone";
import { offsetPartsToMinutes } from "./utc-offset";
import { WINDOWS_TO_IANA } from "./windows-timezones";

type DeclaredTimeZoneOffsets = ReadonlyMap<string, readonly number[]>;

type ResolvedTimeZone =
  | { kind: "iana"; timeZone: string }
  | { kind: "fixed-offset"; timeZone: string; offsetMinutes: number };

const MINUTES_PER_HOUR = 60;
const MAX_FIXED_OFFSET_MINUTES = 14 * MINUTES_PER_HOUR;
const MAX_IANA_ZONE_SEGMENTS = 3;
const UTC_OFFSET_PATTERN = /^([+-])(\d{2})(\d{2})(\d{2})?$/;
const FIRST_CONSTANT_OFFSET_YEAR = 1990;
const LAST_CONSTANT_OFFSET_YEAR = 2100;
const CONSTANT_OFFSET_SAMPLE_MONTHS = [0, 6];
const PREFILTER_INSTANTS = [new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 6, 1))];

const constantOffsetZones = new Map<number, string | undefined>();

const asIana = (timeZone: string): ResolvedTimeZone => ({ kind: "iana", timeZone });

const resolveWindowsName = (identifier: string): ResolvedTimeZone | undefined => {
  const timeZone = WINDOWS_TO_IANA[identifier];
  if (!timeZone) {
    return;
  }
  return asIana(timeZone);
};

const resolveIntlName = (identifier: string): ResolvedTimeZone | undefined => {
  if (!canFormatTimeZone(identifier)) {
    return;
  }
  return asIana(identifier);
};

const resolvePrefixedName = (identifier: string): ResolvedTimeZone | undefined => {
  if (!identifier.startsWith("/")) {
    return;
  }
  const segments = identifier.split("/").filter(Boolean);
  const candidates = Array.from(
    { length: Math.min(MAX_IANA_ZONE_SEGMENTS, segments.length) },
    (_unused, index) => segments.slice(-(index + 1)).join("/"),
  ).toReversed();
  const timeZone = candidates.find((candidate) => canFormatTimeZone(candidate));
  if (!timeZone) {
    return;
  }
  return asIana(timeZone);
};

const buildConstantOffsetSamples = (): Date[] => Array.from(
  { length: LAST_CONSTANT_OFFSET_YEAR - FIRST_CONSTANT_OFFSET_YEAR + 1 },
  (_unused, index) => CONSTANT_OFFSET_SAMPLE_MONTHS.map(
    (month) => new Date(Date.UTC(FIRST_CONSTANT_OFFSET_YEAR + index, month, 1)),
  ),
).flat();

const holdsOffsetAt = (timeZone: string, offsetMinutes: number, instants: readonly Date[]): boolean =>
  instants.every((instant) => readTimeZoneOffsetMinutes(timeZone, instant) === offsetMinutes);

const searchConstantOffsetZone = (offsetMinutes: number): string | undefined => {
  const samples = buildConstantOffsetSamples();
  return listSupportedTimeZones()
    .filter((timeZone) => holdsOffsetAt(timeZone, offsetMinutes, PREFILTER_INSTANTS))
    .filter((timeZone) => holdsOffsetAt(timeZone, offsetMinutes, samples))
    .toSorted()
    .at(0);
};

const findConstantOffsetIanaZone = (offsetMinutes: number): string | undefined => {
  if (constantOffsetZones.has(offsetMinutes)) {
    return constantOffsetZones.get(offsetMinutes);
  }
  const timeZone = searchConstantOffsetZone(offsetMinutes);
  constantOffsetZones.set(offsetMinutes, timeZone);
  return timeZone;
};

const formatWholeHourTimeZone = (offsetMinutes: number): string => {
  const hours = offsetMinutes / MINUTES_PER_HOUR;
  if (hours === 0) {
    return "Etc/UTC";
  }
  if (hours < 0) {
    return `Etc/GMT+${Math.abs(hours)}`;
  }
  return `Etc/GMT-${hours}`;
};

const timeZoneForFixedOffset = (offsetMinutes: number): string | undefined => {
  if (offsetMinutes % MINUTES_PER_HOUR === 0) {
    return formatWholeHourTimeZone(offsetMinutes);
  }
  return findConstantOffsetIanaZone(offsetMinutes);
};

const readSingleDeclaredOffset = (offsets: readonly number[]): number | undefined => {
  const uniqueOffsets = new Set(offsets);
  const [offsetMinutes] = uniqueOffsets;
  if (uniqueOffsets.size !== 1 || offsetMinutes === globalThis.undefined) {
    return;
  }
  if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > MAX_FIXED_OFFSET_MINUTES) {
    return;
  }
  return offsetMinutes;
};

const resolveDeclaredFixedOffset = (
  identifier: string,
  declaredOffsets: DeclaredTimeZoneOffsets | undefined,
): ResolvedTimeZone | undefined => {
  const offsets = declaredOffsets?.get(identifier);
  if (!offsets) {
    return;
  }
  const offsetMinutes = readSingleDeclaredOffset(offsets);
  if (offsetMinutes === globalThis.undefined) {
    return;
  }
  const timeZone = timeZoneForFixedOffset(offsetMinutes);
  if (!timeZone) {
    return;
  }
  return { kind: "fixed-offset", offsetMinutes, timeZone };
};

const resolveTimeZoneIdentifier = (
  identifier: string | undefined,
  declaredOffsets?: DeclaredTimeZoneOffsets,
): ResolvedTimeZone | undefined => {
  if (!identifier) {
    return;
  }
  return resolveWindowsName(identifier)
    ?? resolveIntlName(identifier)
    ?? resolvePrefixedName(identifier)
    ?? resolveDeclaredFixedOffset(identifier, declaredOffsets);
};

const resolveDeclaredTimeZone = (
  identifier: string | undefined,
  declaredOffsets: DeclaredTimeZoneOffsets,
): string | undefined => resolveTimeZoneIdentifier(identifier, declaredOffsets)?.timeZone;

const parseUtcOffsetMinutes = (offset: string): number | undefined => {
  const match = UTC_OFFSET_PATTERN.exec(offset.trim());
  if (!match) {
    return;
  }
  const [, sign, hours, minutes, seconds = "0"] = match;
  if (!sign || !hours || !minutes) {
    return;
  }
  return offsetPartsToMinutes(sign, hours, minutes, seconds);
};

const readDeclaredTimeZoneOffsets = (ical: string): DeclaredTimeZoneOffsets => {
  const declared = new Map<string, number[]>();
  let currentTimeZoneId = "";
  visitIcsProperties(ical, ({ componentPath, property, value }) => {
    if (!componentPath.includes("VTIMEZONE")) {
      return;
    }
    if (property === "TZID" && componentPath.at(-1) === "VTIMEZONE") {
      currentTimeZoneId = value;
      declared.set(currentTimeZoneId, declared.get(currentTimeZoneId) ?? []);
      return;
    }
    if (property !== "TZOFFSETTO" || !currentTimeZoneId) {
      return;
    }
    const offsetMinutes = parseUtcOffsetMinutes(value);
    if (offsetMinutes === globalThis.undefined) {
      return;
    }
    declared.get(currentTimeZoneId)?.push(offsetMinutes);
  });
  return declared;
};

export { readDeclaredTimeZoneOffsets, resolveDeclaredTimeZone, resolveTimeZoneIdentifier };
export type { DeclaredTimeZoneOffsets, ResolvedTimeZone };
