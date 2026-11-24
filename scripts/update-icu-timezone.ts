const ICU_TIMEZONE_FILES = ["metaZones.res", "timezoneTypes.res", "windowsZones.res", "zoneinfo64.res"];
const TZDB_VERSION_PATTERN = /^\d{4}[a-z]$/;
const TIMEZONE_DIRECTORY = new URL("../docker/icu-timezone/", import.meta.url);
const REQUIRED_VERSION_FILE = new URL("../packages/calendar/src/utils/timezone-data-currency.ts", import.meta.url);
const REQUIRED_VERSION_PATTERN = /^const REQUIRED_TIME_ZONE_DATA_VERSION = "\d{4}[a-z]";$/mu;

const version = process.argv[2];
if (!version || !TZDB_VERSION_PATTERN.test(version)) {
  console.error("Usage: bun scripts/update-icu-timezone.ts <tzdb version, e.g. 2026f>");
  process.exit(1);
}

const downloadTimezoneFile = async (fileName: string): Promise<void> => {
  const url = `https://raw.githubusercontent.com/unicode-org/icu-data/main/tzdata/icunew/${version}/44/le/${fileName}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  await Bun.write(new URL(fileName, TIMEZONE_DIRECTORY), response);
};

const requireVersion = async (): Promise<void> => {
  const source = await Bun.file(REQUIRED_VERSION_FILE).text();
  if (!REQUIRED_VERSION_PATTERN.test(source)) {
    throw new Error(`${REQUIRED_VERSION_FILE.pathname} has no REQUIRED_TIME_ZONE_DATA_VERSION to update`);
  }
  await Bun.write(
    REQUIRED_VERSION_FILE,
    source.replace(REQUIRED_VERSION_PATTERN, `const REQUIRED_TIME_ZONE_DATA_VERSION = ${JSON.stringify(version)};`),
  );
};

await Promise.all(ICU_TIMEZONE_FILES.map(downloadTimezoneFile));
await Bun.write(new URL("VERSION", TIMEZONE_DIRECTORY), `${version}\n`);
await requireVersion();
console.log(`ICU timezone data updated to ${version}`);
