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
const BACKFILL_SPREAD_MS = 10 * 60 * 1000;

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

interface ScheduleRow {
  calendarId: string;
  dueInMs: number | null;
  failureCount: number;
  parkedReason: string | null;
}

const readOrderedJournalEntries = async (): Promise<JournalEntry[]> => {
  const journal = await Bun.file(`${DRIZZLE_DIRECTORY}/meta/_journal.json`)
    .json() as Journal;
  return journal.entries.toSorted((first, second) => first.idx - second.idx);
};

const findIndexBeforeScheduleTable = async (): Promise<number> => {
  for (const entry of await readOrderedJournalEntries()) {
    const migration = await Bun.file(`${DRIZZLE_DIRECTORY}/${entry.tag}.sql`).text();
    if (migration.includes(`CREATE TABLE "source_ingest_schedule"`)) {
      return entry.idx - 1;
    }
  }
  throw new Error("No migration creates the source ingest schedule");
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
    INSERT INTO "user" ("id", "name", "email") VALUES ('schedule-owner', 'Owner', 'owner@keeper.test')
  `);
  await client.query(`
    INSERT INTO "calendar_accounts" ("id", "authType", "provider", "userId")
    VALUES ('00000000-0000-4000-8000-000000000001', 'oauth', 'google', 'schedule-owner')
  `);
  await client.query(`
    INSERT INTO "calendars" (
      "id", "accountId", "calendarType", "name", "userId", "capabilities", "disabled",
      "ingestFailureCount", "ingestWindowStart", "ingestWindowEnd", "ingestWindowRecordedAt"
    )
    VALUES
      ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'oauth', 'Never read', 'schedule-owner', ARRAY['pull', 'push'], false, 0, NULL, NULL, NULL),
      ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', 'oauth', 'Read before', 'schedule-owner', ARRAY['pull', 'push'], false, 4, now() - interval '30 days', now() + interval '1 year', now() - interval '1 hour'),
      ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-000000000001', 'oauth', 'Disabled', 'schedule-owner', ARRAY['pull', 'push'], true, 0, NULL, NULL, NULL),
      ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-000000000001', 'oauth', 'Push only', 'schedule-owner', ARRAY['push'], false, 0, NULL, NULL, NULL)
  `);
};

const readSchedule = async (client: Client): Promise<ScheduleRow[]> => {
  const result = await client.query<ScheduleRow>(`
    SELECT
      "calendarId",
      (extract(epoch from ("dueAt" - now())) * 1000)::float8 AS "dueInMs",
      "failureCount",
      "parkedReason"
    FROM "source_ingest_schedule"
    ORDER BY "calendarId"
  `);
  return result.rows;
};

describe("existing calendars join the ingest schedule", () => {
  it("schedules every calendar, reads never-read ones first, spreads the rest and parks the unreadable", async () => {
    const seedIndex = await findIndexBeforeScheduleTable();
    const databaseUrl = await createDatabase("keeper_ingest_schedule_backfill");
    await applyReleasedSchemaState(databaseUrl, seedIndex);
    await withConnection(databaseUrl, seedCalendars);

    await runMigrationRunner(databaseUrl);

    await withConnection(databaseUrl, async (client) => {
      const [neverRead, readBefore, disabled, pushOnly] = await readSchedule(client);
      expect(neverRead?.parkedReason).toBeNull();
      expect(neverRead?.dueInMs).toBeLessThanOrEqual(0);
      expect(readBefore?.parkedReason).toBeNull();
      expect(readBefore?.failureCount).toBe(4);
      expect(readBefore?.dueInMs).toBeGreaterThan(-5000);
      expect(readBefore?.dueInMs).toBeLessThanOrEqual(BACKFILL_SPREAD_MS);
      expect(disabled).toMatchObject({ dueInMs: null, parkedReason: "ineligible" });
      expect(pushOnly).toMatchObject({ dueInMs: null, parkedReason: "ineligible" });
    });
  });

  it("keeps scheduling calendars that an older writer inserts after the upgrade", async () => {
    const databaseUrl = await createDatabase("keeper_ingest_schedule_old_writer");
    await runMigrationRunner(databaseUrl);

    await withConnection(databaseUrl, async (client) => {
      await seedCalendars(client);
      const rows = await readSchedule(client);
      expect(rows).toHaveLength(4);
      expect(rows.filter(({ parkedReason }) => parkedReason === null)).toHaveLength(2);
    });
  });
});
