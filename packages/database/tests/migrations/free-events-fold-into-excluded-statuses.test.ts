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
  excludeAvailabilities: string[];
  id: string;
}

const readOrderedJournalEntries = async (): Promise<JournalEntry[]> => {
  const journal = await Bun.file(`${DRIZZLE_DIRECTORY}/meta/_journal.json`)
    .json() as Journal;
  return journal.entries.toSorted((first, second) => first.idx - second.idx);
};

const findFreeEventsFoldEntry = async (): Promise<JournalEntry | null> => {
  for (const entry of await readOrderedJournalEntries()) {
    const migration = await Bun.file(`${DRIZZLE_DIRECTORY}/${entry.tag}.sql`).text();
    if (migration.includes(`DROP COLUMN IF EXISTS "excludeFreeEvents"`)) {
      return entry;
    }
  }
  return null;
};

const findSchemaIndexBeforeFreeEventsFold = async (): Promise<number> => {
  const fold = await findFreeEventsFoldEntry();
  if (!fold) {
    throw new Error("No migration folds excludeFreeEvents into excludeAvailabilities");
  }
  return fold.idx - 1;
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
    VALUES ('free-events-owner', 'Free Events Owner', 'free-events@keeper.test')
  `);
  const account = await client.query<{ id: string }>(`
    INSERT INTO "calendar_accounts" ("userId", "provider", "authType")
    VALUES ('free-events-owner', 'ics', 'none')
    RETURNING "id"
  `);
  const accountId = account.rows[0]?.id;
  await client.query(
    `
      INSERT INTO "calendars"
        ("id", "accountId", "userId", "calendarType", "name", "excludeFreeEvents", "excludeAvailabilities")
      VALUES
        ('00000000-0000-4000-8000-000000000001', $1, 'free-events-owner', 'ical', 'Excludes free', true, '{}'),
        ('00000000-0000-4000-8000-000000000002', $1, 'free-events-owner', 'ical', 'Already lists free', true, '{busy,free}'),
        ('00000000-0000-4000-8000-000000000003', $1, 'free-events-owner', 'ical', 'Keeps free', false, '{tentative}')
    `,
    [accountId],
  );
};

const readCalendars = async (client: Client): Promise<CalendarRow[]> => {
  const calendars = await client.query<CalendarRow>(`
    SELECT "id", "excludeAvailabilities" FROM "calendars" ORDER BY "id"
  `);
  return calendars.rows;
};

const hasFreeEventsColumn = async (client: Client): Promise<boolean> => {
  const columns = await client.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendars' AND column_name = 'excludeFreeEvents'
  `);
  return columns.rows.length > 0;
};

const replayFreeEventsFold = async (client: Client): Promise<void> => {
  const entry = await findFreeEventsFoldEntry();
  if (!entry) {
    throw new Error("No migration folds excludeFreeEvents into excludeAvailabilities");
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

const FOLDED_CALENDARS: CalendarRow[] = [
  { excludeAvailabilities: ["free"], id: "00000000-0000-4000-8000-000000000001" },
  { excludeAvailabilities: ["busy", "free"], id: "00000000-0000-4000-8000-000000000002" },
  { excludeAvailabilities: ["tentative"], id: "00000000-0000-4000-8000-000000000003" },
];

describe("excludeFreeEvents folding into excludeAvailabilities", () => {
  it("carries every enabled free exclusion into the status list and drops the column", async () => {
    const seedIndex = await findSchemaIndexBeforeFreeEventsFold();
    const databaseUrl = await createDatabase("keeper_free_events_fold");
    await applyReleasedSchemaState(databaseUrl, seedIndex);
    await withConnection(databaseUrl, seedCalendars);

    await runMigrationRunner(databaseUrl);

    await withConnection(databaseUrl, async (client) => {
      expect(await readCalendars(client)).toEqual(FOLDED_CALENDARS);
      expect(await hasFreeEventsColumn(client)).toBe(false);
    });
  });

  it("changes nothing when the fold is replayed after the column is gone", async () => {
    const seedIndex = await findSchemaIndexBeforeFreeEventsFold();
    const databaseUrl = await createDatabase("keeper_free_events_fold_replay");
    await applyReleasedSchemaState(databaseUrl, seedIndex);
    await withConnection(databaseUrl, seedCalendars);
    await runMigrationRunner(databaseUrl);

    await withConnection(databaseUrl, async (client) => {
      await replayFreeEventsFold(client);

      expect(await readCalendars(client)).toEqual(FOLDED_CALENDARS);
    });
  });
});
