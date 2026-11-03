import { resolveTimeZoneIdentifier } from "./resolve-timezone-identifier";

/**
 * Resolves an identifier for time math through the shared resolver: Windows
 * names map through CLDR, Intl names and links stay as given, and tzurl-prefixed
 * ids recover their trailing IANA zone. Labels it cannot resolve come back as
 * given, so callers decide whether they are supported. It never takes a fixed
 * offset, because that needs the feed's declared VTIMEZONE.
 */
const normalizeTimezone = (timezone: string | undefined): string | undefined => {
  if (!timezone) {
    return;
  }

  return resolveTimeZoneIdentifier(timezone)?.timeZone ?? timezone;
};

export { normalizeTimezone };
