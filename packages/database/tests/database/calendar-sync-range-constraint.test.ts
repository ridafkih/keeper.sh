import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { SYNC_RANGE_DEFINITIONS } from "@keeper.sh/data-schemas";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const migrationScript = `${import.meta.dirname}/../../scripts/migrate.ts`;
const templateName = `keeper_range_template_${process.pid}`;
const scratchNames: string[] = [];

const withAdministrativeClient = async <Result>(
  run: (client: Client) => Promise<Result>,
): Promise<Result> => {
  const client = new Client({ connectionString: administrativeUrl });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
};

const withDatabaseClient = async <Result>(
  databaseName: string,
  run: (client: Client) => Promise<Result>,
): Promise<Result> => {
  const url = new URL(administrativeUrl ?? "postgres://localhost");
  url.pathname = `/${databaseName}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
};

const runMigrations = async (databaseName: string): Promise<void> => {
  const url = new URL(administrativeUrl ?? "postgres://localhost");
  url.pathname = `/${databaseName}`;
  const result = await Bun.$`bun ${migrationScript}`
    .env({ ...process.env, DATABASE_URL: url.toString() })
    .quiet()
    .nothrow();
  if (result.exitCode !== 0) {
    throw new Error(
      `Migration failed for ${databaseName}: ${result.stdout.toString()}${result.stderr.toString()}`,
    );
  }
};

const createScratchDatabase = async (label: string): Promise<string> => {
  const name = `keeper_range_${label}_${process.pid}`;
  scratchNames.push(name);
  await withAdministrativeClient(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
    await client.query(`CREATE DATABASE "${name}" TEMPLATE "${templateName}"`);
  });
  return name;
};

const readConstraint = async (
  client: Client,
  name: string,
): Promise<{ validated: boolean } | null> => {
  const result = await client.query<{ validated: boolean }>(`
    SELECT convalidated AS validated
    FROM pg_constraint
    WHERE conname = '${name}'
      AND conrelid = 'calendars'::regclass
  `);
  const [constraint = null] = result.rows;
  return constraint;
};

/*
 * Databases released before this change carry the schema without the checks.
 * Dropping them and rewinding the journal row reproduces that upgrade origin
 * exactly, rather than approximating it by replaying partial migration files.
 */
const rewindMigrationJournal = async (databaseName: string): Promise<void> => {
  await withDatabaseClient(databaseName, async (client) => {
    await client.query(`
      DELETE FROM drizzle.__drizzle_migrations
      WHERE id = (SELECT id FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1)
    `);
  });
};

const rewindToPreConstraintState = async (databaseName: string): Promise<void> => {
  await withDatabaseClient(databaseName, async (client) => {
    await client.query(`
      ALTER TABLE "calendars"
        DROP CONSTRAINT IF EXISTS "calendars_sync_ranges_check",
        DROP CONSTRAINT IF EXISTS "calendars_ingest_coverage_check"
    `);
  });
  await rewindMigrationJournal(databaseName);
};

const seedCalendar = async (
  client: Client,
  overrides: Record<string, string>,
): Promise<string> => {
  const userId = `user-${Math.random().toString(36).slice(2)}`;
  await client.query(
    `INSERT INTO "user" ("id", "email", "name") VALUES ($1, $2, $3)`,
    [userId, `${userId}@example.com`, "Range Fixture"],
  );
  const account = await client.query<{ id: string }>(
    `INSERT INTO "calendar_accounts" ("authType", "provider", "userId")
     VALUES ('oauth', 'google', $1) RETURNING "id"`,
    [userId],
  );
  const accountId = account.rows[0]?.id;
  if (!accountId) {
    throw new Error("Failed to seed a calendar account");
  }
  const ranges = {
    ingestFutureRange: "2_years",
    ingestHistoricRange: "1_month",
    syncFutureRange: "2_years",
    syncHistoricRange: "1_month",
    ...overrides,
  };
  const calendar = await client.query<{ id: string }>(
    `INSERT INTO "calendars"
       ("accountId", "calendarType", "name", "userId",
        "syncHistoricRange", "syncFutureRange", "ingestHistoricRange", "ingestFutureRange")
     VALUES ($1, 'google', 'Fixture', $2, $3, $4, $5, $6)
     RETURNING "id"`,
    [
      accountId,
      userId,
      ranges.syncHistoricRange,
      ranges.syncFutureRange,
      ranges.ingestHistoricRange,
      ranges.ingestFutureRange,
    ],
  );
  const calendarId = calendar.rows[0]?.id;
  if (!calendarId) {
    throw new Error("Failed to seed a calendar");
  }
  return calendarId;
};

const readCalendarRanges = async (
  client: Client,
  calendarId: string,
): Promise<Record<string, string>> => {
  const result = await client.query<Record<string, string>>(
    `SELECT "syncHistoricRange", "syncFutureRange", "ingestHistoricRange", "ingestFutureRange", "name"
     FROM "calendars" WHERE "id" = $1`,
    [calendarId],
  );
  const [row] = result.rows;
  if (!row) {
    throw new Error(`Calendar ${calendarId} disappeared during migration`);
  }
  return row;
};

describe.skipIf(!administrativeUrl)("calendar sync-range check constraints", () => {
  beforeAll(async () => {
    await withAdministrativeClient(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${templateName}"`);
      await client.query(`CREATE DATABASE "${templateName}"`);
    });
    await runMigrations(templateName);
  }, 300_000);

  afterAll(async () => {
    await withAdministrativeClient(async (client) => {
      for (const name of [...scratchNames, templateName]) {
        await client.query(`DROP DATABASE IF EXISTS "${name}"`);
      }
    });
  }, 120_000);

  it("installs validated constraints on a fresh install", async () => {
    await withDatabaseClient(templateName, async (client) => {
      const syncRanges = await readConstraint(client, "calendars_sync_ranges_check");
      const ingestCoverage = await readConstraint(client, "calendars_ingest_coverage_check");
      expect(syncRanges?.validated).toBe(true);
      expect(ingestCoverage?.validated).toBe(true);

      const applied = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
      );
      const journal = await Bun.file(
        `${import.meta.dirname}/../../drizzle/meta/_journal.json`,
      ).json() as { entries: unknown[] };
      expect(Number(applied.rows[0]?.count)).toBe(journal.entries.length);
    });
  }, 120_000);

  it("upgrades a populated database without touching valid rows", async () => {
    const databaseName = await createScratchDatabase("populated");
    await rewindToPreConstraintState(databaseName);

    const calendarId = await withDatabaseClient(databaseName, (client) =>
      seedCalendar(client, {
        ingestFutureRange: "12_months",
        ingestHistoricRange: "3_months",
        syncFutureRange: "6_months",
        syncHistoricRange: "1_week",
      }));

    await runMigrations(databaseName);

    await withDatabaseClient(databaseName, async (client) => {
      expect(await readCalendarRanges(client, calendarId)).toEqual({
        ingestFutureRange: "12_months",
        ingestHistoricRange: "3_months",
        name: "Fixture",
        syncFutureRange: "6_months",
        syncHistoricRange: "1_week",
      });
      const constraint = await readConstraint(client, "calendars_sync_ranges_check");
      expect(constraint?.validated).toBe(true);
    });
  }, 300_000);

  it("normalizes invalid rows instead of failing the upgrade", async () => {
    const databaseName = await createScratchDatabase("invalid");
    await rewindToPreConstraintState(databaseName);

    const seeded = await withDatabaseClient(databaseName, async (client) => {
      const corrupt = await seedCalendar(client, {
        ingestFutureRange: "1 Week",
        ingestHistoricRange: "110762ms",
        syncFutureRange: "b1f0c4d2-0000-4000-8000-000000000000",
        syncHistoricRange: "1_fortnight",
      });
      const healthy = await seedCalendar(client, { syncHistoricRange: "6_months" });
      return { corrupt, healthy };
    });

    await runMigrations(databaseName);

    await withDatabaseClient(databaseName, async (client) => {
      expect(await readCalendarRanges(client, seeded.corrupt)).toEqual({
        ingestFutureRange: "2_years",
        ingestHistoricRange: "1_month",
        name: "Fixture",
        syncFutureRange: "2_years",
        syncHistoricRange: "1_month",
      });
      expect(await readCalendarRanges(client, seeded.healthy)).toEqual({
        ingestFutureRange: "2_years",
        ingestHistoricRange: "1_month",
        name: "Fixture",
        syncFutureRange: "2_years",
        syncHistoricRange: "6_months",
      });
      const constraint = await readConstraint(client, "calendars_sync_ranges_check");
      expect(constraint?.validated).toBe(true);
    });
  }, 300_000);

  /*
   * Every database already running this release carries these constraints from
   * the migration runner, which installed them outside the journal. The new
   * statement lands on top of them, so it has to tolerate their presence.
   */
  it("applies over constraints the migration runner already installed", async () => {
    const databaseName = await createScratchDatabase("preinstalled");
    await rewindMigrationJournal(databaseName);

    const calendarId = await withDatabaseClient(databaseName, (client) =>
      seedCalendar(client, { syncFutureRange: "3_months" }));

    await runMigrations(databaseName);

    await withDatabaseClient(databaseName, async (client) => {
      const ranges = await readCalendarRanges(client, calendarId);
      expect(ranges.syncFutureRange).toBe("3_months");
      const constraint = await readConstraint(client, "calendars_sync_ranges_check");
      expect(constraint?.validated).toBe(true);
    });
  }, 300_000);

  /*
   * The generated statement was hand-edited to repair rows before constraining
   * them. Without that repair the ALTER aborts and the instance never starts,
   * so the unrepaired form is asserted to fail rather than trusted to.
   */
  it("would have failed the upgrade without the normalizing statements", async () => {
    const databaseName = await createScratchDatabase("unrepaired");
    await rewindToPreConstraintState(databaseName);

    await withDatabaseClient(databaseName, async (client) => {
      await seedCalendar(client, { syncHistoricRange: "110762ms" });
      await expect(client.query(`
        ALTER TABLE "calendars" ADD CONSTRAINT "calendars_sync_ranges_check"
        CHECK ("syncHistoricRange" IN (${SYNC_RANGE_DEFINITIONS.map(({ value }) => `'${value}'`).join(", ")}))
      `)).rejects.toThrow(/violated by some row/);
    });
  }, 300_000);

  it("rejects invalid writes and accepts every defined range", async () => {
    const databaseName = await createScratchDatabase("enforcement");

    await withDatabaseClient(databaseName, async (client) => {
      const calendarId = await seedCalendar(client, {});

      for (const column of [
        "syncHistoricRange",
        "syncFutureRange",
        "ingestHistoricRange",
        "ingestFutureRange",
      ]) {
        await expect(client.query(
          `UPDATE "calendars" SET "${column}" = '110762ms' WHERE "id" = $1`,
          [calendarId],
        )).rejects.toThrow(/violates check constraint/);
      }

      for (const { value } of SYNC_RANGE_DEFINITIONS) {
        await client.query(
          `UPDATE "calendars"
           SET "syncHistoricRange" = $1, "syncFutureRange" = $1,
               "ingestHistoricRange" = $1, "ingestFutureRange" = $1
           WHERE "id" = $2`,
          [value, calendarId],
        );
        const ranges = await readCalendarRanges(client, calendarId);
        expect(ranges.syncHistoricRange).toBe(value);
        expect(ranges.ingestFutureRange).toBe(value);
      }

      await expect(seedCalendar(client, { syncFutureRange: "3_years" }))
        .rejects.toThrow(/violates check constraint/);
    });
  }, 300_000);

  it("stays safe to re-run against an already migrated database", async () => {
    const databaseName = await createScratchDatabase("idempotent");

    await runMigrations(databaseName);
    await runMigrations(databaseName);

    await withDatabaseClient(databaseName, async (client) => {
      const duplicates = await client.query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM pg_constraint
        WHERE conrelid = 'calendars'::regclass
          AND conname IN ('calendars_sync_ranges_check', 'calendars_ingest_coverage_check')
      `);
      expect(Number(duplicates.rows[0]?.count)).toBe(2);
    });
  }, 300_000);
});
