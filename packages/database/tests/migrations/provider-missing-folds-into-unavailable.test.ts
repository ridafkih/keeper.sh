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

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

interface CalendarRow {
  id: string;
  providerMissingSince: Date | null;
  unavailableSince: Date | null;
}

const MISSING_ONLY = "00000000-0000-4000-8000-000000000001";
const BOTH_FLAGS = "00000000-0000-4000-8000-000000000002";
const UNAVAILABLE_ONLY = "00000000-0000-4000-8000-000000000003";
const HEALTHY = "00000000-0000-4000-8000-000000000004";

const PROVIDER_MISSING_AT = new Date("2026-09-01T10:00:00.000Z");
const UNAVAILABLE_AT = new Date("2026-09-05T10:00:00.000Z");

const readOrderedJournalEntries = async (): Promise<JournalEntry[]> => {
  const journal = await Bun.file(`${DRIZZLE_DIRECTORY}/meta/_journal.json`)
    .json() as Journal;
  return journal.entries.toSorted((first, second) => first.idx - second.idx);
};

const FOLD_TAG = "0108_provider_missing_folds_into_unavailable";

const findFoldEntry = async (): Promise<JournalEntry> => {
  const entries = await readOrderedJournalEntries();
  const entry = entries.find(({ tag }) => tag === FOLD_TAG);
  if (!entry) {
    throw new Error(`Migration ${FOLD_TAG} is missing from the journal`);
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

const seedCalendars = async (client: Client): Promise<void> => {
  await client.query(`
    INSERT INTO "user" ("id", "name", "email")
    VALUES ('missing-flag-owner', 'Missing Flag Owner', 'missing-flag@keeper.test')
  `);
  const account = await client.query<{ id: string }>(`
    INSERT INTO "calendar_accounts" ("userId", "provider", "authType")
    VALUES ('missing-flag-owner', 'google', 'oauth')
    RETURNING "id"
  `);
  const accountId = account.rows[0]?.id;
  await client.query(
    `
      INSERT INTO "calendars"
        ("id", "accountId", "userId", "calendarType", "name", "providerMissingSince", "unavailableSince")
      VALUES
        ($2, $1, 'missing-flag-owner', 'oauth', 'Missing only', $6, NULL),
        ($3, $1, 'missing-flag-owner', 'oauth', 'Both flags', $6, $7),
        ($4, $1, 'missing-flag-owner', 'oauth', 'Unavailable only', NULL, $7),
        ($5, $1, 'missing-flag-owner', 'oauth', 'Healthy', NULL, NULL)
    `,
    [accountId, MISSING_ONLY, BOTH_FLAGS, UNAVAILABLE_ONLY, HEALTHY, PROVIDER_MISSING_AT, UNAVAILABLE_AT],
  );
};

const readCalendars = async (client: Client): Promise<CalendarRow[]> => {
  const calendars = await client.query<CalendarRow>(`
    SELECT "id", "providerMissingSince", "unavailableSince" FROM "calendars" ORDER BY "id"
  `);
  return calendars.rows;
};

const replayFold = async (client: Client): Promise<void> => {
  const migration = await Bun.file(`${DRIZZLE_DIRECTORY}/${FOLD_TAG}.sql`).text();
  const statements = migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  for (const statement of statements) {
    await client.query(statement);
  }
};

const FOLDED_CALENDARS: CalendarRow[] = [
  { id: MISSING_ONLY, providerMissingSince: null, unavailableSince: PROVIDER_MISSING_AT },
  { id: BOTH_FLAGS, providerMissingSince: null, unavailableSince: UNAVAILABLE_AT },
  { id: UNAVAILABLE_ONLY, providerMissingSince: null, unavailableSince: UNAVAILABLE_AT },
  { id: HEALTHY, providerMissingSince: null, unavailableSince: null },
];

const migrateSeededDatabase = async (name: string): Promise<string> => {
  const fold = await findFoldEntry();
  const databaseUrl = await createDatabase(name);
  await applyReleasedSchemaState(databaseUrl, fold.idx - 1);
  await withConnection(databaseUrl, seedCalendars);
  await runMigrationRunner(databaseUrl);
  return databaseUrl;
};

describe("providerMissingSince folding into unavailableSince", () => {
  it("carries every not-found-at-provider flag into unavailability so rediscovery can revive it", async () => {
    const databaseUrl = await migrateSeededDatabase("keeper_provider_missing_fold");

    await withConnection(databaseUrl, async (client) => {
      expect(await readCalendars(client)).toEqual(FOLDED_CALENDARS);
    });
  });

  it("changes nothing when the fold is replayed", async () => {
    const databaseUrl = await migrateSeededDatabase("keeper_provider_missing_fold_replay");

    await withConnection(databaseUrl, async (client) => {
      await replayFold(client);

      expect(await readCalendars(client)).toEqual(FOLDED_CALENDARS);
    });
  });
});
