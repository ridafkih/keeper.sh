import { WINDOWS_TO_IANA } from "./windows-timezones";

/**
 * Microsoft Exchange and Outlook name timezones by their Windows identifiers in
 * exported .ics files and Graph responses (e.g. "Eastern Standard Time" instead of
 * "America/New_York"). These are rejected by providers like Google Calendar that
 * require IANA IDs, so they are mapped through CLDR's windowsZones.xml, regenerated
 * with scripts/update-windows-timezones.ts whenever Microsoft adds a zone.
 */
const normalizeTimezone = (timezone: string | undefined): string | undefined => {
  if (!timezone) {
    return;
  }

  return WINDOWS_TO_IANA[timezone] ?? timezone;
};

export { normalizeTimezone };
