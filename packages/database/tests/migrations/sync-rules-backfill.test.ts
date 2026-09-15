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

interface RuleRow {
  actions: unknown;
  conditions: unknown;
  isDefault: boolean;
  name: string;
}

interface AssignmentRow {
  destination: string;
  position: number;
  rule: string;
  source: string;
}

const readOrderedJournalEntries = async (): Promise<JournalEntry[]> => {
  const journal = await Bun.file(`${DRIZZLE_DIRECTORY}/meta/_journal.json`).json() as Journal;
  return journal.entries.toSorted((first, second) => first.idx - second.idx);
};

const findSyncRulesEntry = async (): Promise<JournalEntry> => {
  for (const entry of await readOrderedJournalEntries()) {
    const migration = await Bun.file(`${DRIZZLE_DIRECTORY}/${entry.tag}.sql`).text();
    if (migration.includes(`"sync_rule_assignments"`)) {
      return entry;
    }
  }
  throw new Error("No migration creates sync rules");
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

const seedCalendars = async (client: Client): Promise<void> => {
  await client.query(`
    INSERT INTO "user" ("id", "name", "email") VALUES
      ('mapped-user', 'Mapped User', 'mapped@keeper.test'),
      ('idle-user', 'Idle User', 'idle@keeper.test')
  `);
  await client.query(`
    INSERT INTO "calendar_accounts" ("id", "userId", "provider", "authType") VALUES
      ('11111111-1111-4111-8111-111111111111', 'mapped-user', 'google', 'oauth'),
      ('22222222-2222-4222-8222-222222222222', 'idle-user', 'google', 'oauth')
  `);
  await client.query(`
    INSERT INTO "calendars" (
      "id", "userId", "accountId", "name", "calendarType", "capabilities",
      "excludeEventName", "customEventName", "excludeEventDescription", "excludeEventLocation",
      "markEventsAsPrivate", "excludeAllDayEvents"
    ) VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'mapped-user', '11111111-1111-4111-8111-111111111111', 'Work', 'oauth', '{pull,push}', true, '{{calendar_name}}', true, true, false, false),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'mapped-user', '11111111-1111-4111-8111-111111111111', 'Custom', 'oauth', '{pull,push}', false, '{{calendar_name}}', false, false, true, true),
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'mapped-user', '11111111-1111-4111-8111-111111111111', 'Personal', 'oauth', '{pull,push}', true, '{{calendar_name}}', true, true, false, false),
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'idle-user', '22222222-2222-4222-8222-222222222222', 'Unmapped', 'oauth', '{pull,push}', true, '{{calendar_name}}', true, true, false, true)
  `);
  await client.query(`
    INSERT INTO "source_destination_mappings" ("sourceCalendarId", "destinationCalendarId") VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
  `);
};

const readRules = async (client: Client): Promise<RuleRow[]> => {
  const rules = await client.query<RuleRow>(`
    SELECT "name", "conditions", "actions", "isDefault" FROM "sync_rules" ORDER BY "name"
  `);
  return rules.rows;
};

const readAssignments = async (client: Client): Promise<AssignmentRow[]> => {
  const assignments = await client.query<AssignmentRow>(`
    SELECT s."name" AS "source", d."name" AS "destination", r."name" AS "rule", a."position"
    FROM "sync_rule_assignments" a
    INNER JOIN "calendars" s ON s."id" = a."sourceCalendarId"
    INNER JOIN "calendars" d ON d."id" = a."destinationCalendarId"
    INNER JOIN "sync_rules" r ON r."id" = a."ruleId"
    ORDER BY s."name", a."position"
  `);
  return assignments.rows;
};

const replaySyncRulesMigration = async (client: Client): Promise<void> => {
  const entry = await findSyncRulesEntry();
  const migration = await Bun.file(`${DRIZZLE_DIRECTORY}/${entry.tag}.sql`).text();
  const statements = migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  for (const statement of statements) {
    await client.query(statement);
  }
};

const EXPECTED_RULES: RuleRow[] = [
  {
    actions: [
      { kind: "rename", template: "{{calendar_name}}" },
      { kind: "drop_description" },
      { kind: "drop_location" },
    ],
    conditions: [],
    isDefault: true,
    name: "Busy only",
  },
  { actions: [{ kind: "mark_private" }], conditions: [], isDefault: false, name: "Custom settings" },
  { actions: [{ kind: "skip" }], conditions: [{ kind: "all_day" }], isDefault: false, name: "Skip all-day events" },
];

const EXPECTED_ASSIGNMENTS: AssignmentRow[] = [
  { destination: "Personal", position: 0, rule: "Skip all-day events", source: "Custom" },
  { destination: "Personal", position: 1, rule: "Custom settings", source: "Custom" },
  { destination: "Personal", position: 0, rule: "Busy only", source: "Work" },
];

describe("sync rules backfill", () => {
  it("turns each mapped calendar's switches into rules applied to its pairs", async () => {
    const entry = await findSyncRulesEntry();
    const databaseUrl = await createDatabase("keeper_sync_rules_backfill");
    await applyReleasedSchemaState(databaseUrl, entry.idx - 1);
    await withConnection(databaseUrl, seedCalendars);

    await runMigrationRunner(databaseUrl);

    await withConnection(databaseUrl, async (client) => {
      expect(await readRules(client)).toEqual(EXPECTED_RULES);
      expect(await readAssignments(client)).toEqual(EXPECTED_ASSIGNMENTS);
    });
  });

  it("changes nothing when replayed over an already migrated database", async () => {
    const entry = await findSyncRulesEntry();
    const databaseUrl = await createDatabase("keeper_sync_rules_replay");
    await applyReleasedSchemaState(databaseUrl, entry.idx - 1);
    await withConnection(databaseUrl, seedCalendars);
    await runMigrationRunner(databaseUrl);

    await withConnection(databaseUrl, async (client) => {
      await replaySyncRulesMigration(client);

      expect(await readRules(client)).toEqual(EXPECTED_RULES);
      expect(await readAssignments(client)).toEqual(EXPECTED_ASSIGNMENTS);
    });
  });
});
