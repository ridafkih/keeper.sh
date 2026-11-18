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
const CLEANUP_TAG = "0114_pending_registration_reclaims";

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

interface VerificationRow {
  identifier: string;
}

const findCleanupEntry = async (): Promise<JournalEntry> => {
  const journal = await Bun.file(`${DRIZZLE_DIRECTORY}/meta/_journal.json`)
    .json() as Journal;
  const entry = journal.entries.find(({ tag }) => tag === CLEANUP_TAG);
  if (!entry) {
    throw new Error(`Migration ${CLEANUP_TAG} is missing from the journal`);
  }
  return entry;
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

const applyReleasedSchemaState = async (
  databaseUrl: string,
  throughIndex: number,
): Promise<void> => {
  const journal = await Bun.file(`${DRIZZLE_DIRECTORY}/meta/_journal.json`)
    .json() as Journal;
  const entries = journal.entries.filter(({ idx }) => idx <= throughIndex);
  if (entries.length === 0) {
    throw new Error(`No migrations found at or below ${throughIndex}`);
  }
  const folder = await mkdtemp(join(tmpdir(), "keeper-released-schema-"));
  await mkdir(join(folder, "meta"));
  await writeFile(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }),
  );
  for (const entry of entries) {
    await copyFile(
      `${DRIZZLE_DIRECTORY}/${entry.tag}.sql`,
      join(folder, `${entry.tag}.sql`),
    );
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
  const [exitCode, failure] = await Promise.all([
    runner.exited,
    new Response(runner.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Migration runner exited ${exitCode}: ${failure}`);
  }
};

const withConnection = async <Result>(
  databaseUrl: string,
  use: (client: Client) => Promise<Result>,
): Promise<Result> => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
};

const seedVerifications = async (client: Client): Promise<void> => {
  await client.query(`
    INSERT INTO "verification" ("id", "identifier", "value", "expiresAt")
    VALUES
      ('pending-reclaim', 'unverified-registration-reclaim:owner@keeper.test', '{"name":"Name","passwordHash":"hash"}', now() + interval '1 hour'),
      ('expired-reclaim', 'unverified-registration-reclaim:other@keeper.test', '{"name":"Name","passwordHash":"hash"}', now() - interval '1 hour'),
      ('password-reset', 'reset-password:token', 'user-id', now() + interval '1 hour'),
      ('email-change', 'owner@keeper.test', 'token', now() + interval '1 hour')
  `);
};

const readIdentifiers = async (client: Client): Promise<string[]> => {
  const verifications = await client.query<VerificationRow>(`
    SELECT "identifier" FROM "verification" ORDER BY "identifier"
  `);
  return verifications.rows.map(({ identifier }) => identifier);
};

describe("stored registration reclaims", () => {
  it("are removed while other verification rows are kept", async () => {
    const cleanup = await findCleanupEntry();
    const databaseUrl = await createDatabase("keeper_pending_registration_reclaims");
    await applyReleasedSchemaState(databaseUrl, cleanup.idx - 1);
    await withConnection(databaseUrl, seedVerifications);

    await runMigrationRunner(databaseUrl);

    await withConnection(databaseUrl, async (client) => {
      expect(await readIdentifiers(client)).toEqual([
        "owner@keeper.test",
        "reset-password:token",
      ]);
    });
  });
});
