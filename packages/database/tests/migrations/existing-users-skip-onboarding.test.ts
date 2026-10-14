import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

const ADMIN_DATABASE_URL = Bun.env.MIGRATION_TEST_DATABASE_URL;

if (!ADMIN_DATABASE_URL) {
  throw new Error("MIGRATION_TEST_DATABASE_URL is missing");
}

const PACKAGE_ROOT = `${import.meta.dirname}/../..`;
const DRIZZLE_DIRECTORY = `${PACKAGE_ROOT}/drizzle`;
const ONBOARDING_MIGRATION_TAG = "0100_onboarding_status";

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

interface OnboardingRow {
  id: string;
  onboardingStatus: string;
}

const readJournal = async (): Promise<Journal> =>
  await Bun.file(`${DRIZZLE_DIRECTORY}/meta/_journal.json`).json() as Journal;

const findIndexBeforeOnboarding = async (): Promise<number> => {
  const { entries } = await readJournal();
  const onboarding = entries.find(({ tag }) => tag === ONBOARDING_MIGRATION_TAG);
  if (!onboarding) {
    throw new Error(`No ${ONBOARDING_MIGRATION_TAG} migration in the journal`);
  }
  return onboarding.idx - 1;
};

const createDatabase = async (name: string): Promise<string> => {
  const admin = new Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const databaseUrl = new URL(ADMIN_DATABASE_URL);
  databaseUrl.pathname = `/${name}`;
  return databaseUrl.toString();
};

const applyReleasedSchemaState = async (databaseUrl: string, throughIndex: number): Promise<void> => {
  const journal = await readJournal();
  const entries = journal.entries.filter(({ idx }) => idx <= throughIndex);
  const folder = await mkdtemp(join(tmpdir(), "keeper-released-schema-"));
  await mkdir(join(folder, "meta"));
  await writeFile(join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const entry of entries) {
    await copyFile(`${DRIZZLE_DIRECTORY}/${entry.tag}.sql`, join(folder, `${entry.tag}.sql`));
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally {
    await client.end();
    await rm(folder, { force: true, recursive: true });
  }
};

const runMigrationRunner = async (databaseUrl: string): Promise<void> => {
  const runner = Bun.spawn(["bun", "scripts/migrate.ts"], {
    cwd: PACKAGE_ROOT,
    env: { ...Bun.env, DATABASE_URL: databaseUrl },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, failure] = await Promise.all([runner.exited, new Response(runner.stderr).text()]);
  if (exitCode !== 0) {
    throw new Error(`Migration runner exited ${exitCode}: ${failure}`);
  }
};

const withConnection = async <Result>(databaseUrl: string, use: (client: Client) => Promise<Result>): Promise<Result> => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
};

const readStatuses = async (client: Client): Promise<OnboardingRow[]> => {
  const result = await client.query<OnboardingRow>(`SELECT "id", "onboardingStatus" FROM "user" ORDER BY "id"`);
  return result.rows;
};

describe("onboarding status migration", () => {
  it("marks existing users as done and starts new users on pending", async () => {
    const databaseUrl = await createDatabase("keeper_onboarding_status");
    await applyReleasedSchemaState(databaseUrl, await findIndexBeforeOnboarding());
    await withConnection(databaseUrl, (client) => client.query(`
      INSERT INTO "user" ("id", "name", "email") VALUES ('existing-user', 'Existing User', 'existing@keeper.test')
    `));

    await runMigrationRunner(databaseUrl);

    await withConnection(databaseUrl, async (client) => {
      await client.query(`INSERT INTO "user" ("id", "name", "email") VALUES ('new-user', 'New User', 'new@keeper.test')`);
      expect(await readStatuses(client)).toEqual([
        { id: "existing-user", onboardingStatus: "completed" },
        { id: "new-user", onboardingStatus: "pending" },
      ]);
      await expect(client.query(`UPDATE "user" SET "onboardingStatus" = 'unknown' WHERE "id" = 'new-user'`))
        .rejects.toThrow(/user_onboarding_status_check/);
    });
  });
});
