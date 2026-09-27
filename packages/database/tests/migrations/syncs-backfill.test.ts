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

const readOrderedJournalEntries = async (): Promise<JournalEntry[]> => {
  const journal = await Bun.file(`${DRIZZLE_DIRECTORY}/meta/_journal.json`).json() as Journal;
  return journal.entries.toSorted((first, second) => first.idx - second.idx);
};

const findSyncsEntry = async (): Promise<JournalEntry> => {
  for (const entry of await readOrderedJournalEntries()) {
    const migration = await Bun.file(`${DRIZZLE_DIRECTORY}/${entry.tag}.sql`).text();
    if (migration.includes(`CREATE TABLE IF NOT EXISTS "syncs"`)) {
      return entry;
    }
  }
  throw new Error("No migration creates syncs");
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
  const journal = await Bun.file(`${DRIZZLE_DIRECTORY}/meta/_journal.json`).json() as Journal;
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

interface SyncRow {
  busyTitle: string | null;
  calendars: string;
  markPrivate: boolean;
  mode: string;
  name: string;
  shareAs: string;
  skipAllDay: boolean;
  skipFocusTime: boolean;
  skipOutOfOffice: boolean;
}

interface PairRow {
  destination: string;
  source: string;
  sync: string;
}

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

const seedCalendars = async (client: Client): Promise<void> => {
  await client.query(`
    INSERT INTO "user" ("id", "name", "email") VALUES
      ('mapped-user', 'Mapped User', 'mapped@keeper.test'),
      ('idle-user', 'Idle User', 'idle@keeper.test')
  `);
  await client.query(`
    INSERT INTO "calendar_accounts" ("id", "userId", "provider", "authType") VALUES
      ('${ACCOUNT_ID}', 'mapped-user', 'google', 'oauth'),
      ('22222222-2222-4222-8222-222222222222', 'idle-user', 'google', 'oauth')
  `);
  await client.query(`
    INSERT INTO "calendars" (
      "id", "userId", "accountId", "name", "calendarType", "capabilities",
      "excludeEventName", "customEventName", "excludeEventDescription", "excludeEventLocation",
      "markEventsAsPrivate", "excludeAllDayEvents", "excludeFocusTime"
    ) VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'mapped-user', '${ACCOUNT_ID}', 'Work', 'oauth', '{pull,push}', true, '{{calendar_name}}', true, true, false, false, false),
      ('abababab-abab-4bab-8bab-abababababab', 'mapped-user', '${ACCOUNT_ID}', 'School', 'oauth', '{pull,push}', true, '{{calendar_name}}', true, true, false, false, false),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'mapped-user', '${ACCOUNT_ID}', 'Custom', 'oauth', '{pull,push}', false, '{{calendar_name}}', false, false, true, true, false),
      ('bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc', 'mapped-user', '${ACCOUNT_ID}', 'Named', 'oauth', '{pull,push}', true, 'Taken', true, true, false, false, true),
      ('bdbdbdbd-bdbd-4dbd-8dbd-bdbdbdbdbdbd', 'mapped-user', '${ACCOUNT_ID}', 'Partial', 'oauth', '{pull,push}', false, '{{calendar_name}}', true, false, false, false, false),
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'mapped-user', '${ACCOUNT_ID}', 'Personal', 'oauth', '{pull,push}', true, '{{calendar_name}}', true, true, false, false, false),
      ('cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd', 'mapped-user', '${ACCOUNT_ID}', 'Family', 'oauth', '{pull,push}', true, '{{calendar_name}}', true, true, false, false, false),
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'idle-user', '22222222-2222-4222-8222-222222222222', 'Unmapped', 'oauth', '{pull,push}', true, '{{calendar_name}}', true, true, false, true, false)
  `);
  await client.query(`
    INSERT INTO "source_destination_mappings" ("sourceCalendarId", "destinationCalendarId") VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      ('abababab-abab-4bab-8bab-abababababab', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      ('bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc', 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'),
      ('bdbdbdbd-bdbd-4dbd-8dbd-bdbdbdbdbdbd', 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'),
      ('bdbdbdbd-bdbd-4dbd-8dbd-bdbdbdbdbdbd', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
  `);
};

// Local databases ran an earlier draft of this migration, which left these tables behind.
const seedEarlierDraftTables = async (client: Client): Promise<void> => {
  await client.query(`CREATE TABLE "sync_rules" ("id" uuid PRIMARY KEY)`);
  await client.query(`CREATE TABLE "sync_rule_assignments" ("id" uuid PRIMARY KEY, "ruleId" uuid REFERENCES "sync_rules"("id"))`);
};

const readSyncs = async (client: Client): Promise<SyncRow[]> => {
  const syncs = await client.query<SyncRow>(`
    SELECT
      s."name", s."mode", s."shareAs", s."busyTitle", s."markPrivate",
      s."skipAllDay", s."skipFocusTime", s."skipOutOfOffice",
      string_agg(c."name" || ':' || sc."role", ',' ORDER BY sc."role" DESC, sc."position") AS "calendars"
    FROM "syncs" s
    INNER JOIN "sync_calendars" sc ON sc."syncId" = s."id"
    INNER JOIN "calendars" c ON c."id" = sc."calendarId"
    GROUP BY s."id"
    ORDER BY s."name"
  `);
  return syncs.rows;
};

const readPairs = async (client: Client): Promise<PairRow[]> => {
  const pairs = await client.query<PairRow>(`
    SELECT s."name" AS "source", d."name" AS "destination", y."name" AS "sync"
    FROM "source_destination_mappings" m
    INNER JOIN "calendars" s ON s."id" = m."sourceCalendarId"
    INNER JOIN "calendars" d ON d."id" = m."destinationCalendarId"
    INNER JOIN "syncs" y ON y."id" = m."syncId"
    ORDER BY s."name", d."name"
  `);
  return pairs.rows;
};

const tableExists = async (client: Client, table: string): Promise<boolean> => {
  const result = await client.query<{ exists: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS "exists"`, [`public.${table}`]);
  return result.rows[0]?.exists === true;
};

const replaySyncsMigration = async (client: Client): Promise<void> => {
  const entry = await findSyncsEntry();
  const migration = await Bun.file(`${DRIZZLE_DIRECTORY}/${entry.tag}.sql`).text();
  const statements = migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  for (const statement of statements) {
    await client.query(statement);
  }
};

const busy = { busyTitle: null, markPrivate: false, mode: "one_way", shareAs: "busy_only", skipAllDay: false, skipFocusTime: false, skipOutOfOffice: false };

const EXPECTED_SYNCS: SyncRow[] = [
  { ...busy, calendars: "Custom:source,Personal:destination", markPrivate: true, name: "Custom → Personal", shareAs: "full", skipAllDay: true },
  { ...busy, busyTitle: "Taken", calendars: "Named:source,Family:destination", name: "Named → Family", skipFocusTime: true },
  { ...busy, calendars: "Partial:source,Family:destination,Personal:destination", name: "Partial → Family, Personal", shareAs: "title_only" },
  { ...busy, calendars: "School:source,Work:source,Personal:destination", name: "School, Work → Personal" },
];

const EXPECTED_PAIRS: PairRow[] = [
  { destination: "Personal", source: "Custom", sync: "Custom → Personal" },
  { destination: "Family", source: "Named", sync: "Named → Family" },
  { destination: "Family", source: "Partial", sync: "Partial → Family, Personal" },
  { destination: "Personal", source: "Partial", sync: "Partial → Family, Personal" },
  { destination: "Personal", source: "School", sync: "School, Work → Personal" },
  { destination: "Personal", source: "Work", sync: "School, Work → Personal" },
];

describe("syncs backfill", () => {
  it("groups mapped calendars with matching settings and destinations into syncs", async () => {
    const entry = await findSyncsEntry();
    const databaseUrl = await createDatabase("keeper_syncs_backfill");
    await applyReleasedSchemaState(databaseUrl, entry.idx - 1);
    await withConnection(databaseUrl, async (client) => {
      await seedCalendars(client);
      await seedEarlierDraftTables(client);
    });

    await runMigrationRunner(databaseUrl);

    await withConnection(databaseUrl, async (client) => {
      expect(await readSyncs(client)).toEqual(EXPECTED_SYNCS);
      expect(await readPairs(client)).toEqual(EXPECTED_PAIRS);
      expect(await tableExists(client, "sync_rules")).toBe(false);
      expect(await tableExists(client, "sync_rule_assignments")).toBe(false);
    });
  });

  it("changes nothing when replayed over an already migrated database", async () => {
    const entry = await findSyncsEntry();
    const databaseUrl = await createDatabase("keeper_syncs_replay");
    await applyReleasedSchemaState(databaseUrl, entry.idx - 1);
    await withConnection(databaseUrl, seedCalendars);
    await runMigrationRunner(databaseUrl);

    await withConnection(databaseUrl, async (client) => {
      await replaySyncsMigration(client);

      expect(await readSyncs(client)).toEqual(EXPECTED_SYNCS);
      expect(await readPairs(client)).toEqual(EXPECTED_PAIRS);
    });
  });
});
