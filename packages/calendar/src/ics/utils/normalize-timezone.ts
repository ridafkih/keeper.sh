import { resolveTimeZoneIdentifier } from "./resolve-timezone-identifier";

const normalizeTimezone = (timezone: string | undefined): string | undefined => {
  if (!timezone) {
    return;
  }

  return resolveTimeZoneIdentifier(timezone)?.timeZone ?? timezone;
};

export { normalizeTimezone };
