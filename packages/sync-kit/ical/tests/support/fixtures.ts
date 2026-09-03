import { fixtureManifest, getFixturePath } from "@keeper.sh/fixtures";
import type { FixtureSource } from "@keeper.sh/fixtures";

const enabledFixtures = (): readonly FixtureSource[] =>
  fixtureManifest.filter((source) => source.enabled !== false);

const fixtureSourceById = (id: string): FixtureSource => {
  const source = enabledFixtures().find((candidate) => candidate.id === id);
  if (!source) {
    throw new Error(`unknown fixture: ${id}`);
  }
  return source;
};

const fixturePathById = (id: string): string => getFixturePath(fixtureSourceById(id));

const readFixture = (source: FixtureSource): Promise<string> =>
  Bun.file(getFixturePath(source)).text();

export { enabledFixtures, fixturePathById, fixtureSourceById, readFixture };
