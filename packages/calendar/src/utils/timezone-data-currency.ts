import { readFileSync } from "node:fs";
import { join } from "node:path";

const REQUIRED_TIME_ZONE_DATA_VERSION = "2026f";

const TIME_ZONE_DATA_VERSION_PATTERN = /^(\d{4})([a-z])$/;
const TIME_ZONE_DATA_DIRECTORY_VARIABLE = "ICU_TIMEZONE_FILES_DIR";

interface TimeZoneDataVersion {
  year: number;
  release: string;
}

const parseTimeZoneDataVersion = (version: string | undefined): TimeZoneDataVersion | null => {
  const match = version?.match(TIME_ZONE_DATA_VERSION_PATTERN);
  if (!match) {
    return null;
  }
  const [, year, release] = match;
  return { release: release ?? "", year: Number(year) };
};

const isAtLeast = (version: TimeZoneDataVersion, minimum: TimeZoneDataVersion): boolean => {
  if (version.year !== minimum.year) {
    return version.year > minimum.year;
  }
  return version.release >= minimum.release;
};

const describeVersion = (version: string | undefined): string => {
  if (typeof version !== "string") {
    return "no tz data version";
  }
  return `tz data version ${JSON.stringify(version)}`;
};

const assertTimeZoneDataCurrent = (
  runtimeVersion: string | undefined,
  requiredVersion: string,
): void => {
  const minimum = parseTimeZoneDataVersion(requiredVersion);
  if (!minimum) {
    throw new Error(`Required tz data version ${JSON.stringify(requiredVersion)} is malformed`);
  }
  const configured = parseTimeZoneDataVersion(runtimeVersion);
  if (configured && isAtLeast(configured, minimum)) {
    return;
  }
  throw new Error(
    `Found ${describeVersion(runtimeVersion)} but ${requiredVersion} or newer is required. Set ${TIME_ZONE_DATA_DIRECTORY_VARIABLE} to a directory holding ICU tz data ${requiredVersion} or newer, such as docker/icu-timezone.`,
  );
};

const isMissingFileError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const readConfiguredTimeZoneDataVersion = (directory: string | undefined): string | undefined => {
  if (!directory) {
    return;
  }
  try {
    return readFileSync(join(directory, "VERSION"), "utf8").trim();
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }
    throw error;
  }
};

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const exitUnlessTimeZoneDataCurrent = (directory: string | undefined): void => {
  try {
    assertTimeZoneDataCurrent(
      readConfiguredTimeZoneDataVersion(directory),
      REQUIRED_TIME_ZONE_DATA_VERSION,
    );
  } catch (error) {
    process.stderr.write(`${describeError(error)}\n`);
    process.exit(1);
  }
};

export {
  REQUIRED_TIME_ZONE_DATA_VERSION,
  assertTimeZoneDataCurrent,
  exitUnlessTimeZoneDataCurrent,
  readConfiguredTimeZoneDataVersion,
};
