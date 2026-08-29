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
const MICROSOFT_PROVIDER_ID = "microsoft";

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

interface RegistrationRow {
  emailVerified: boolean;
  id: string;
}

const readOrderedJournalEntries = async (): Promise<JournalEntry[]> => {
  const journal = await Bun.file(`${DRIZZLE_DIRECTORY}/meta/_journal.json`)
    .json() as Journal;
  return journal.entries.toSorted((first, second) => first.idx - second.idx);
};

const findVerificationBackfillEntry = async (): Promise<JournalEntry | null> => {
  for (const entry of await readOrderedJournalEntries()) {
    const migration = await Bun.file(`${DRIZZLE_DIRECTORY}/${entry.tag}.sql`).text();
    if (
      migration.includes(`"emailVerified"`)
      && migration.includes(`'${MICROSOFT_PROVIDER_ID}'`)
    ) {
      return entry;
    }
  }
  return null;
};

const findSchemaIndexBeforeVerificationBackfill = async (): Promise<number> => {
  const entries = await readOrderedJournalEntries();
  const backfill = await findVerificationBackfillEntry();
  if (backfill) {
    return backfill.idx - 1;
  }
  return Math.max(...entries.map(({ idx }) => idx));
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

const seedRegistrations = async (client: Client): Promise<void> => {
  await client.query(`
    INSERT INTO "user" ("id", "name", "email", "emailVerified")
    VALUES
      ('outlook-registration', 'Outlook Registration', 'outlook@keeper.test', false),
      ('password-registration', 'Password Registration', 'password@keeper.test', false),
      ('settled-outlook-registration', 'Settled Outlook Registration', 'settled@keeper.test', true)
  `);
  await client.query(`
    INSERT INTO "account" ("id", "userId", "accountId", "providerId")
    VALUES
      ('outlook-account', 'outlook-registration', 'entra-object-id', '${MICROSOFT_PROVIDER_ID}'),
      ('password-account', 'password-registration', 'password-registration', 'credential'),
      ('settled-outlook-account', 'settled-outlook-registration', 'settled-entra-object-id', '${MICROSOFT_PROVIDER_ID}')
  `);
};

const readRegistrations = async (client: Client): Promise<RegistrationRow[]> => {
  const registrations = await client.query<RegistrationRow>(`
    SELECT "id", "emailVerified" FROM "user" ORDER BY "id"
  `);
  return registrations.rows;
};

const replayVerificationBackfill = async (client: Client): Promise<void> => {
  const entry = await findVerificationBackfillEntry();
  if (!entry) {
    throw new Error(
      "No migration records existing microsoft registrations as verified",
    );
  }
  const migration = await Bun.file(`${DRIZZLE_DIRECTORY}/${entry.tag}.sql`).text();
  const statements = migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  for (const statement of statements) {
    await client.query(statement);
  }
};

describe("existing outlook registrations", () => {
  it("records a microsoft registration as verified and leaves other registrations alone", async () => {
    const seedIndex = await findSchemaIndexBeforeVerificationBackfill();
    const databaseUrl = await createDatabase("keeper_outlook_verification_backfill");
    await applyReleasedSchemaState(databaseUrl, seedIndex);
    await withConnection(databaseUrl, seedRegistrations);

    await runMigrationRunner(databaseUrl);

    await withConnection(databaseUrl, async (client) => {
      expect(await readRegistrations(client)).toEqual([
        { emailVerified: true, id: "outlook-registration" },
        { emailVerified: false, id: "password-registration" },
        { emailVerified: true, id: "settled-outlook-registration" },
      ]);
    });
  });

  it("changes nothing when the correction is replayed over an already corrected database", async () => {
    const seedIndex = await findSchemaIndexBeforeVerificationBackfill();
    const databaseUrl = await createDatabase("keeper_outlook_verification_replay");
    await applyReleasedSchemaState(databaseUrl, seedIndex);
    await withConnection(databaseUrl, seedRegistrations);
    await runMigrationRunner(databaseUrl);

    await withConnection(databaseUrl, async (client) => {
      const corrected = await readRegistrations(client);

      await replayVerificationBackfill(client);

      expect(await readRegistrations(client)).toEqual(corrected);
      expect(corrected).toEqual([
        { emailVerified: true, id: "outlook-registration" },
        { emailVerified: false, id: "password-registration" },
        { emailVerified: true, id: "settled-outlook-registration" },
      ]);
    });
  });
});
