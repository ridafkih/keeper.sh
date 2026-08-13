/**
 * Timezone identifier recovery for real-world ICS feeds.
 *
 * RFC 5545 lets a feed name its own TZID as long as a matching VTIMEZONE is
 * declared, so plenty of clients ship identifiers Intl has never heard of:
 * Thunderbird/Lightning writes tzurl-style `/mozilla.org/<version>/America/Denver`,
 * and Exchange writes labels such as `Customized Time Zone` or
 * `(UTC-07:00) Mountain Time (US & Canada)`. The zone information is still in
 * the file, so recover it instead of rejecting the event: extract the trailing
 * IANA zone from prefixed identifiers, and fall back to the offset the declared
 * VTIMEZONE uses when that VTIMEZONE never changes offset.
 *
 * A VTIMEZONE with DST transitions is deliberately not mapped onto a fixed
 * offset: half the year would be an hour wrong, which is worse than reporting
 * the event as unsupported.
 */

import { normalizeTimezone } from "./normalize-timezone";
import { visitIcsProperties } from "./apply-patches";

type DeclaredTimeZoneOffsets = ReadonlyMap<string, readonly number[]>;

const MINUTES_PER_HOUR = 60;
const MAX_FIXED_OFFSET_HOURS = 14;
const MAX_IANA_ZONE_SEGMENTS = 3;
const UTC_OFFSET_PATTERN = /^([+-])(\d{2})(\d{2})(\d{2})?$/;

const isSupportedTimeZone = (timeZone: string): boolean => {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone });
    return Boolean(formatter);
  } catch {
    return false;
  }
};

const extractPrefixedIanaTimeZone = (identifier: string): string | undefined => {
  if (!identifier.startsWith("/")) {
    return;
  }
  const segments = identifier.split("/").filter(Boolean);
  const candidates = Array.from(
    { length: Math.min(MAX_IANA_ZONE_SEGMENTS, segments.length) },
    (value, index) => segments.slice(-(index + 1)).join("/"),
  ).toReversed();
  return candidates.find((candidate) => isSupportedTimeZone(candidate));
};

const parseUtcOffsetMinutes = (offset: string): number | undefined => {
  const match = UTC_OFFSET_PATTERN.exec(offset.trim());
  if (!match) {
    return;
  }
  const [, sign, hours, minutes] = match;
  if (!sign || !hours || !minutes) {
    return;
  }
  const magnitude = Number(hours) * MINUTES_PER_HOUR + Number(minutes);
  if (sign === "-") {
    return -magnitude;
  }
  return magnitude;
};

/**
 * `Etc/GMT+N` is the IANA zone whose UTC offset is minus N hours, so the sign is
 * inverted on purpose. Fixed zones are used rather than a bare `-07:00` because
 * destination providers require an IANA identifier.
 */
const buildFixedOffsetTimeZone = (offsetMinutes: number): string | undefined => {
  if (offsetMinutes % MINUTES_PER_HOUR !== 0) {
    return;
  }
  const hours = offsetMinutes / MINUTES_PER_HOUR;
  if (Math.abs(hours) > MAX_FIXED_OFFSET_HOURS) {
    return;
  }
  if (hours === 0) {
    return "Etc/UTC";
  }
  if (hours < 0) {
    return `Etc/GMT+${Math.abs(hours)}`;
  }
  return `Etc/GMT-${hours}`;
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

const resolveDeclaredTimeZone = (
  identifier: string | undefined,
  declaredOffsets: DeclaredTimeZoneOffsets,
): string | undefined => {
  const normalized = normalizeTimezone(identifier);
  if (!normalized) {
    return;
  }
  if (isSupportedTimeZone(normalized)) {
    return normalized;
  }
  const extracted = extractPrefixedIanaTimeZone(normalized);
  if (extracted) {
    return extracted;
  }
  const offsets = declaredOffsets.get(normalized)
    ?? declaredOffsets.get(identifier ?? "")
    ?? [];
  const uniqueOffsets = new Set(offsets);
  const [offsetMinutes] = uniqueOffsets;
  if (uniqueOffsets.size !== 1 || offsetMinutes === globalThis.undefined) {
    return;
  }
  return buildFixedOffsetTimeZone(offsetMinutes);
};

export { readDeclaredTimeZoneOffsets, resolveDeclaredTimeZone };
export type { DeclaredTimeZoneOffsets };
