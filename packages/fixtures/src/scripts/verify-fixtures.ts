import { fixtureManifest } from "../manifest";
import { findMissingFixtures } from "../cache";

const run = async (): Promise<void> => {
  const missingFixtures = await findMissingFixtures(fixtureManifest);

  if (missingFixtures.length > 0) {
    throw new Error(`Missing ${missingFixtures.length} fixture file(s).`);
  }
};

await run();
