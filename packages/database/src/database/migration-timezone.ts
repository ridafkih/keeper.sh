const UTC_TIME_ZONE_NAMES = new Set(["UTC", "Etc/UTC", "Universal", "Zulu"]);

/*
 * Columns carrying DEFAULT now() were written by Postgres rather than by the application:
 * now() returns timestamptz, and assigning it to a naked timestamp casts it through the
 * session's TimeZone, so what landed in the column is the SERVER's wall clock. Reading
 * those values back as UTC is only correct when that clock was UTC. Nothing in a
 * connection string pins the server zone, so the migration reads it and rewrites those
 * values to UTC before the conversion when it is anything else.
 */
const isUtcTimeZoneName = (zone: string | null | undefined): boolean => {
  if (!zone) {
    return false;
  }
  return UTC_TIME_ZONE_NAMES.has(zone);
};

export { isUtcTimeZoneName, UTC_TIME_ZONE_NAMES };
