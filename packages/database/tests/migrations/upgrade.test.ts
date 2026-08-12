import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { drizzle as drizzleBunSql } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { createMigrationReadinessDatabase } from "../../src/database/migration-readiness";

const ADMIN_DATABASE_URL = Bun.env.MIGRATION_TEST_DATABASE_URL;

if (!ADMIN_DATABASE_URL) {
  throw new Error("MIGRATION_TEST_DATABASE_URL is missing");
}

const PACKAGE_ROOT = `${import.meta.dirname}/../..`;
const DRIZZLE_DIRECTORY = `${PACKAGE_ROOT}/drizzle`;

/*
 * Migration files are immutable once released, so replaying 0000 through the
 * index a tag shipped reproduces that tag's schema exactly without needing tag
 * history at test time. v2.12.2 shipped 0074, v2.13.5 shipped 0076.
 */
const findSchemaIndexBeforeCoverageCheck = async (): Promise<number> => {
  const journal = await Bun.file(`${DRIZZLE_DIRECTORY}/meta/_journal.json`)
    .json() as Journal;
  const ordered = journal.entries.toSorted((first, second) => first.idx - second.idx);
  for (const entry of ordered) {
    const migration = await Bun.file(`${DRIZZLE_DIRECTORY}/${entry.tag}.sql`).text();
    if (migration.includes("calendars_ingest_coverage_check")) {
      return entry.idx - 1;
    }
  }
  return Math.max(...ordered.map(({ idx }) => idx));
};

const RELEASED_SCHEMA_STATES = {
  v2_12_2: 74,
  v2_13_5: 76,
} as const;

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

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

const isRuntimeReady = async (databaseUrl: string): Promise<boolean> => {
  const connection = new SQL(databaseUrl);
  try {
    return await createMigrationReadinessDatabase(drizzleBunSql(connection))
      .isReady();
  } finally {
    await connection.close();
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

const seedCalendarPair = async (client: Client): Promise<{
  destinationCalendarId: string;
  sourceCalendarId: string;
}> => {
  await client.query(`
    INSERT INTO "user" ("id", "name", "email")
    VALUES ('seed-user', 'Seed User', 'seed@keeper.test')
  `);
  const account = await client.query<{ id: string }>(`
    INSERT INTO "calendar_accounts" ("authType", "provider", "userId")
    VALUES ('oauth', 'google', 'seed-user')
    RETURNING "id"
  `);
  const accountId = account.rows[0]?.id;
  if (!accountId) {
    throw new Error("Expected the seeded calendar account to be inserted");
  }
  const calendars = await client.query<{ id: string }>(`
    INSERT INTO "calendars" ("accountId", "calendarType", "name", "userId")
    VALUES
      ('${accountId}', 'google', 'Source', 'seed-user'),
      ('${accountId}', 'google', 'Destination', 'seed-user')
    RETURNING "id"
  `);
  const [source, destination] = calendars.rows;
  if (!source || !destination) {
    throw new Error("Expected both seeded calendars to be inserted");
  }
  return {
    destinationCalendarId: destination.id,
    sourceCalendarId: source.id,
  };
};

/*
 * Two rows sharing one recurring identity are legal under the 0074 identity
 * index but collide with the unique index 0076 builds, which is the crash-loop
 * the runner's consolidation step exists to prevent.
 */
const seedDuplicateRecurringInstances = async (
  client: Client,
  sourceCalendarId: string,
  destinationCalendarId: string,
): Promise<void> => {
  const states = await client.query<{ id: string }>(`
    INSERT INTO "event_states"
      ("calendarId", "sourceEventUid", "recurrenceId", "startTime", "endTime")
    VALUES
      ('${sourceCalendarId}', 'recurring-uid', '2026-03-01T09:00:00', '2026-03-01T09:00:00', '2026-03-01T10:00:00'),
      ('${sourceCalendarId}', 'recurring-uid', '2026-03-01T09:00:00', '2026-03-01T09:30:00', '2026-03-01T10:30:00')
    RETURNING "id"
  `);
  const [first, second] = states.rows;
  if (!first || !second) {
    throw new Error("Expected both duplicate recurring states to be inserted");
  }
  for (const state of [first, second]) {
    await client.query(`
      INSERT INTO "event_mappings"
        ("calendarId", "destinationEventUid", "eventStateId", "startTime", "endTime")
      VALUES (
        '${destinationCalendarId}',
        'destination-${state.id}',
        '${state.id}',
        '2026-03-01T09:00:00',
        '2026-03-01T10:00:00'
      )
    `);
  }
};

describe("migration runner against postgres", () => {
  it("brings an empty database to the runtime state the API gates on", async () => {
    const databaseUrl = await createDatabase("keeper_migration_fresh");

    await runMigrationRunner(databaseUrl);

    await expect(isRuntimeReady(databaseUrl)).resolves.toBe(true);
  });

  it("is a no-op when re-run over an already migrated database", async () => {
    const databaseUrl = await createDatabase("keeper_migration_rerun");
    await runMigrationRunner(databaseUrl);

    await runMigrationRunner(databaseUrl);

    await expect(isRuntimeReady(databaseUrl)).resolves.toBe(true);
  });

  it("upgrades a v2.12.2 database and consolidates its duplicate recurring states", async () => {
    const databaseUrl = await createDatabase("keeper_migration_v2_12_2");
    await applyReleasedSchemaState(databaseUrl, RELEASED_SCHEMA_STATES.v2_12_2);
    const seeded = await withConnection(databaseUrl, async (client) => {
      const calendars = await seedCalendarPair(client);
      await seedDuplicateRecurringInstances(
        client,
        calendars.sourceCalendarId,
        calendars.destinationCalendarId,
      );
      return calendars;
    });

    await runMigrationRunner(databaseUrl);

    await expect(isRuntimeReady(databaseUrl)).resolves.toBe(true);
    await withConnection(databaseUrl, async (client) => {
      const states = await client.query<{ count: string }>(`
        SELECT count(*)::text AS count FROM "event_states"
      `);
      expect(states.rows[0]?.count).toBe("1");
      const mappings = await client.query<{
        sourceCalendarId: string | null;
        syncEventId: string | null;
      }>(`
        SELECT "sourceCalendarId", "syncEventId" FROM "event_mappings"
      `);
      expect(mappings.rows).toHaveLength(1);
      expect(mappings.rows[0]?.sourceCalendarId).toBe(seeded.sourceCalendarId);
      expect(mappings.rows[0]?.syncEventId).not.toBeNull();
    });
  });

  it("upgrades a v2.13.5 database and preserves mappings as tombstones", async () => {
    const databaseUrl = await createDatabase("keeper_migration_v2_13_5");
    await applyReleasedSchemaState(databaseUrl, RELEASED_SCHEMA_STATES.v2_13_5);
    const seeded = await withConnection(databaseUrl, async (client) => {
      const calendars = await seedCalendarPair(client);
      const state = await client.query<{ id: string }>(`
        INSERT INTO "event_states" ("calendarId", "sourceEventId", "startTime", "endTime")
        VALUES ('${calendars.sourceCalendarId}', 'source-event', '2026-03-02T09:00:00', '2026-03-02T10:00:00')
        RETURNING "id"
      `);
      const eventStateId = state.rows[0]?.id;
      if (!eventStateId) {
        throw new Error("Expected the seeded event state to be inserted");
      }
      await client.query(`
        INSERT INTO "event_mappings"
          ("calendarId", "destinationEventUid", "eventStateId", "startTime", "endTime")
        VALUES (
          '${calendars.destinationCalendarId}',
          'destination-uid',
          '${eventStateId}',
          '2026-03-02T09:00:00',
          '2026-03-02T10:00:00'
        )
      `);
      return { ...calendars, eventStateId };
    });

    await runMigrationRunner(databaseUrl);

    await expect(isRuntimeReady(databaseUrl)).resolves.toBe(true);
    await withConnection(databaseUrl, async (client) => {
      await client.query(`DELETE FROM "event_states" WHERE "id" = '${seeded.eventStateId}'`);
      const mappings = await client.query<{
        eventStateId: string | null;
        sourceCalendarId: string | null;
        syncEventId: string | null;
      }>(`
        SELECT "eventStateId", "sourceCalendarId", "syncEventId" FROM "event_mappings"
      `);
      expect(mappings.rows).toHaveLength(1);
      expect(mappings.rows[0]?.eventStateId).toBeNull();
      expect(mappings.rows[0]?.syncEventId).toBe(seeded.eventStateId);
      expect(mappings.rows[0]?.sourceCalendarId).toBe(seeded.sourceCalendarId);
    });
  });

  /*
   * Coverage normalisation has to run before the checks are validated, or
   * VALIDATE CONSTRAINT aborts on rows written by older writers.
   */
  it("repairs out-of-range coverage while upgrading a database that predates the checks", async () => {
    /*
     * Seed before the coverage check exists. It is added NOT VALID, which still
     * enforces on new rows, so a database that already carries it cannot produce
     * the legacy row this repairs — only an older writer could.
     */
    const seedIndex = await findSchemaIndexBeforeCoverageCheck();
    const databaseUrl = await createDatabase("keeper_migration_coverage");
    await applyReleasedSchemaState(databaseUrl, seedIndex);
    await withConnection(databaseUrl, async (client) => {
      const calendars = await seedCalendarPair(client);
      await client.query(`
        UPDATE "calendars"
        SET
          "syncHistoricRange" = '9_years',
          "ingestFutureRange" = 'forever',
          "ingestWindowStart" = '2026-03-02T00:00:00',
          "ingestWindowEnd" = NULL,
          "ingestWindowRecordedAt" = NULL
        WHERE "id" = '${calendars.sourceCalendarId}'
      `);
    });

    await runMigrationRunner(databaseUrl);

    await expect(isRuntimeReady(databaseUrl)).resolves.toBe(true);
    await withConnection(databaseUrl, async (client) => {
      const calendars = await client.query<{
        ingestFutureRange: string;
        ingestWindowStart: Date | null;
        syncHistoricRange: string;
      }>(`
        SELECT "syncHistoricRange", "ingestFutureRange", "ingestWindowStart"
        FROM "calendars"
        ORDER BY "name"
      `);
      for (const calendar of calendars.rows) {
        expect(calendar.syncHistoricRange).toBe("1_month");
        expect(calendar.ingestFutureRange).toBe("2_years");
        expect(calendar.ingestWindowStart).toBeNull();
      }
    });
  });
});
