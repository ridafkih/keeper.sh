const UTC_TIME_ZONE_NAMES = new Set(["UTC", "Etc/UTC", "Universal", "Zulu"]);

/*
 * Columns carrying DEFAULT now() were written by Postgres rather than by the application:
 * now() returns timestamptz, and assigning it to a naked timestamp casts it through the
 * session's TimeZone, so what landed in the column is the SERVER's wall clock. Reading
 * those values back as UTC is only correct when that clock was UTC. Nothing in a
 * connection string pins the server zone, so the migration asserts it instead of assuming.
 */
const isUtcTimeZoneName = (zone: string | null | undefined): boolean => {
  if (!zone) {
    return false;
  }
  return UTC_TIME_ZONE_NAMES.has(zone);
};

const describeNonUtcTimeZone = (zone: string | null | undefined): string =>
  `This database's server time zone is ${zone ?? "unknown"}, not UTC. Timestamps written`
  + " by column defaults carry that zone's wall clock, so migrating them to timestamptz"
  + " would move every one of them by its offset. Set the Postgres server to UTC"
  + " (ALTER SYSTEM SET timezone = 'UTC', then reload) and run this again.";

export { describeNonUtcTimeZone, isUtcTimeZoneName, UTC_TIME_ZONE_NAMES };
