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
const MEETING_LINK_COLUMN = `ADD COLUMN IF NOT EXISTS "excludeEventMeetingLink"`;

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

interface MeetingLinkRow {
  excludeEventMeetingLink: boolean;
  name: string;
}

const findIndexBeforeMeetingLinkSetting = async (journal: Journal): Promise<number> => {
  for (const entry of journal.entries.toSorted((first, second) => first.idx - second.idx)) {
    const migration = await Bun.file(`${DRIZZLE_DIRECTORY}/${entry.tag}.sql`).text();
    if (migration.includes(MEETING_LINK_COLUMN)) {
      return entry.idx - 1;
    }
  }
  throw new Error("No migration adds the meeting link setting");
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

const applyMigrationsThrough = async (
  databaseUrl: string,
  journal: Journal,
  throughIndex: number,
): Promise<void> => {
  const entries = journal.entries.filter(({ idx }) => idx <= throughIndex);
  const folder = await mkdtemp(join(tmpdir(), "keeper-meeting-link-schema-"));
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
    INSERT INTO "user" ("id", "name", "email") VALUES ('meeting-link-owner', 'Owner', 'owner@keeper.test')
  `);
  await client.query(`
    INSERT INTO "calendar_accounts" ("id", "authType", "provider", "userId")
    VALUES ('00000000-0000-4000-8000-000000000001', 'oauth', 'google', 'meeting-link-owner')
  `);
  await client.query(`
    INSERT INTO "calendars" ("id", "accountId", "calendarType", "name", "userId", "capabilities", "excludeEventDescription")
    VALUES
      ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000001', 'oauth', 'Descriptions on', 'meeting-link-owner', ARRAY['pull'], false),
      ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-000000000001', 'oauth', 'Descriptions off', 'meeting-link-owner', ARRAY['pull'], true)
  `);
};

const readMeetingLinkSettings = async (client: Client): Promise<MeetingLinkRow[]> => {
  const result = await client.query<MeetingLinkRow>(`
    SELECT "name", "excludeEventMeetingLink" FROM "calendars" ORDER BY "name"
  `);
  return result.rows;
};

describe("existing calendars keep meeting links off", () => {
  it("turns the meeting link setting off for every calendar that existed before it", async () => {
    const journal = await Bun.file(`${DRIZZLE_DIRECTORY}/meta/_journal.json`).json() as Journal;
    const databaseUrl = await createDatabase("keeper_meeting_link_backfill");
    await applyMigrationsThrough(databaseUrl, journal, await findIndexBeforeMeetingLinkSetting(journal));
    await withConnection(databaseUrl, seedCalendars);

    await runMigrationRunner(databaseUrl);

    await withConnection(databaseUrl, async (client) => {
      expect(await readMeetingLinkSettings(client)).toEqual([
        { excludeEventMeetingLink: true, name: "Descriptions off" },
        { excludeEventMeetingLink: true, name: "Descriptions on" },
      ]);
    });
  });

  it("leaves mapping overrides inheriting the source calendar's setting", async () => {
    const databaseUrl = await createDatabase("keeper_meeting_link_mapping_override");
    await runMigrationRunner(databaseUrl);

    await withConnection(databaseUrl, async (client) => {
      const result = await client.query<{ is_nullable: string }>(`
        SELECT "is_nullable" FROM information_schema.columns
        WHERE "table_name" = 'source_destination_mappings' AND "column_name" = 'excludeEventMeetingLink'
      `);
      expect(result.rows).toEqual([{ is_nullable: "YES" }]);
    });
  });
});
