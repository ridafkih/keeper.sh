import { fixtureManifest } from "../manifest";
import { syncFixtureFiles } from "../cache";

const FORCE_REFRESH_FLAG = "--refresh";
const INCLUDE_DISABLED_FLAG = "--include-disabled";

const hasFlag = (flag: string): boolean => process.argv.includes(flag);

const run = async (): Promise<void> => {
  await syncFixtureFiles(fixtureManifest, {
    forceRefresh: hasFlag(FORCE_REFRESH_FLAG),
    includeDisabled: hasFlag(INCLUDE_DISABLED_FLAG),
  });
};

await run();
