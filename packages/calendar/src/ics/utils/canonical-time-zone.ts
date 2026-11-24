import { canFormatTimeZone } from "./intl-time-zone";
import { resolveTimeZoneIdentifier } from "./resolve-timezone-identifier";
import { IANA_LINK_TARGETS } from "./timezone-links";

const canonicalNamesByLowercase = new Map<string, string>();

const readCanonicalNames = (): ReadonlyMap<string, string> => {
  if (canonicalNamesByLowercase.size > 0) {
    return canonicalNamesByLowercase;
  }
  for (const timeZone of Intl.supportedValuesOf("timeZone")) {
    canonicalNamesByLowercase.set(timeZone.toLowerCase(), timeZone);
  }
  for (const [link, target] of Object.entries(IANA_LINK_TARGETS)) {
    canonicalNamesByLowercase.set(target.toLowerCase(), target);
    canonicalNamesByLowercase.set(link.toLowerCase(), target);
  }
  return canonicalNamesByLowercase;
};

const lookupCanonicalName = (timeZone: string): string | undefined => {
  const canonical = readCanonicalNames().get(timeZone.toLowerCase());
  if (!canonical || !canFormatTimeZone(canonical)) {
    return;
  }
  return canonical;
};

const canonicalizeTimeZone = (identifier: string | null | undefined): string | undefined => {
  const trimmed = identifier?.trim();
  if (!trimmed) {
    return;
  }
  const resolved = resolveTimeZoneIdentifier(trimmed)?.timeZone ?? trimmed;
  const canonical = lookupCanonicalName(resolved);
  if (canonical) {
    return canonical;
  }
  if (!canFormatTimeZone(resolved)) {
    return;
  }
  return resolved;
};

export { canonicalizeTimeZone };
