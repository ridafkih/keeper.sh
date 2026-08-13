import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { selectPendingSourceCalendarMappings } from "../../src/database/backfill-event-mapping-source-calendar-ids";
import {
  buildLegacyRecurringStateConsolidation,
  shouldConsolidateLegacyRecurringStates,
  type LegacyRecurringStateCompatibility,
} from "../../src/database/legacy-recurring-state-consolidation";

const LEGACY_0070_COMPATIBILITY: LegacyRecurringStateCompatibility = {
  has_legacy_index: true,
  has_recurrence_column: true,
  has_recurring_index: false,
  has_source_event_column: false,
};

const readSyncWindowMigration = async (): Promise<string> => {
  const drizzleDirectory = `${import.meta.dirname}/../../drizzle`;
  const journal = await Bun.file(`${drizzleDirectory}/meta/_journal.json`).json() as {
    entries: { idx: number; tag: string }[];
  };
  const syncWindowMigration = journal.entries.find(({ idx }) => idx === 77);
  if (!syncWindowMigration) {
    throw new Error("Expected the sync-window migration to remain in the journal");
  }
  return Bun.file(`${drizzleDirectory}/${syncWindowMigration.tag}.sql`).text();
};

describe("0077 self-hosted upgrade compatibility", () => {
  it("keeps the generated migration additive and compatible with old writers", async () => {
    const migration = await readSyncWindowMigration();

    expect(migration).toContain('ADD COLUMN "ingestWindowRecordedAt" timestamp');
    expect(migration).toContain('ADD COLUMN "sourceCalendarId" uuid');
    expect(migration).not.toContain('ALTER COLUMN "sourceCalendarId" SET NOT NULL');
    expect(migration).not.toContain('UPDATE "event_mappings"');
    expect(migration).not.toContain('event_mappings_source_calendar_idx');
    expect(migration).not.toContain('event_mappings_identity_check');
  });

  /*
   * Databases at 0070-0074 have no sourceEventId column. Referencing it
   * unguarded aborts migration with 42703, and skipping consolidation instead
   * lets 0076 fail building its unique index over the duplicates consolidation
   * exists to remove. Either way the API entrypoint crash-loops under set -e.
   */
  it("consolidates without naming sourceEventId when the column is absent", () => {
    expect(shouldConsolidateLegacyRecurringStates(LEGACY_0070_COMPATIBILITY))
      .toBe(true);

    const statements = buildLegacyRecurringStateConsolidation(
      LEGACY_0070_COMPATIBILITY.has_source_event_column,
    );

    expect(statements).toHaveLength(4);
    for (const statement of statements) {
      expect(statement).not.toContain("sourceEventId");
    }
    const ranking = statements.filter((statement) =>
      statement.includes("ranked_states AS"));
    expect(ranking).toHaveLength(2);
    for (const statement of ranking) {
      expect(statement).toContain(`WHERE "sourceEventUid" IS NOT NULL`);
    }
    expect(statements[1]).toContain("consolidation.mapping_rank > 1");
  });

  it("restricts consolidation to unresolved source events once 0075 adds the column", () => {
    const statements = buildLegacyRecurringStateConsolidation(true);

    const ranking = statements.filter((statement) =>
      statement.includes("ranked_states AS"));
    expect(ranking).toHaveLength(2);
    for (const statement of ranking) {
      expect(statement).toContain(
        `WHERE "sourceEventId" IS NULL AND "sourceEventUid" IS NOT NULL`,
      );
    }
  });

  it("skips consolidation only once the recurring instance index exists", () => {
    expect(shouldConsolidateLegacyRecurringStates(null)).toBe(false);
    expect(shouldConsolidateLegacyRecurringStates({
      ...LEGACY_0070_COMPATIBILITY,
      has_recurring_index: true,
    })).toBe(false);
    expect(shouldConsolidateLegacyRecurringStates({
      ...LEGACY_0070_COMPATIBILITY,
      has_legacy_index: false,
    })).toBe(false);
    expect(shouldConsolidateLegacyRecurringStates({
      ...LEGACY_0070_COMPATIBILITY,
      has_recurrence_column: false,
    })).toBe(false);
    expect(shouldConsolidateLegacyRecurringStates({
      ...LEGACY_0070_COMPATIBILITY,
      has_source_event_column: true,
    })).toBe(true);
  });

  /*
   * Without a cursor every batch rescans the rows it already filled, and the
   * supporting index is only created after the backfill runs — quadratic work
   * that can outlast the compose healthcheck window and strand the stack.
   */
  it("walks the source-calendar backfill with a keyset cursor on id", () => {
    const database = drizzle(new Client({ connectionString: "postgres://unused" }));

    const firstBatch = selectPendingSourceCalendarMappings(database, 1000, null)
      .toSQL();
    expect(firstBatch.sql).toContain(`order by "event_mappings"."id" asc`);
    expect(firstBatch.sql).not.toContain(`"event_mappings"."id" >`);
    expect(firstBatch.params).toEqual([1000]);

    const nextBatch = selectPendingSourceCalendarMappings(
      database,
      1000,
      "mapping-1000",
    ).toSQL();
    expect(nextBatch.sql).toContain(
      `where ("event_mappings"."sourceCalendarId" is null and "event_mappings"."id" > $1)`,
    );
    expect(nextBatch.sql).toContain(`order by "event_mappings"."id" asc`);
    expect(nextBatch.params).toEqual(["mapping-1000", 1000]);
  });

  it("routes the package migration command through serialized backfill verification", async () => {
    const packageJson = await Bun.file(`${import.meta.dirname}/../../package.json`).json();
    const migrateScript = await Bun.file(
      `${import.meta.dirname}/../../scripts/migrate.ts`,
    ).text();
    const backfillSource = await Bun.file(
      `${import.meta.dirname}/../../src/database/backfill-event-mapping-sync-event-ids.ts`,
    ).text();

    expect(packageJson.scripts.migrate).toBe("bun scripts/migrate.ts");
    expect(migrateScript).toContain("pg_advisory_lock");
    expect(migrateScript).toContain("lock_timeout");
    expect(migrateScript).toContain("keeper_fill_event_mapping_compatibility");
    expect(migrateScript).toContain("OLD.\"eventStateId\"");
    expect(migrateScript).toContain("buildLegacyRecurringStateConsolidation");
    expect(migrateScript.indexOf("installPreMigrationTombstoneProtection()"))
      .toBeLessThan(migrateScript.indexOf("await migrate(database"));
    expect(migrateScript.indexOf("consolidateLegacyRecurringEventStates()"))
      .toBeLessThan(migrateScript.indexOf("await migrate(database"));
    expect(migrateScript).toContain('ALTER COLUMN "eventStateId" DROP NOT NULL');
    expect(migrateScript).toContain("backfillEventMappingSourceCalendarIds");
    expect(migrateScript).toContain("backfillEventMappingSyncEventIds");
    expect(migrateScript).toContain("CREATE INDEX CONCURRENTLY");
    expect(migrateScript).toContain("indisvalid");
    expect(migrateScript).toContain("confdeltype::text");
    expect(migrateScript).not.toContain(
      'FOREIGN KEY ("sourceCalendarId") REFERENCES "calendars"',
    );
    expect(migrateScript).toContain("NOT VALID");
    expect(migrateScript).toContain("VALIDATE CONSTRAINT");
    expect(backfillSource).toContain("legacy-mapping:");
    const sourceCalendarBackfill = await Bun.file(
      `${import.meta.dirname}/../../src/database/backfill-event-mapping-source-calendar-ids.ts`,
    ).text();
    expect(sourceCalendarBackfill).toContain("isNotNull(eventMappingsTable.eventStateId)");
  });

  it("ships migration runtime dependencies and gates separate services on API readiness", async () => {
    const repositoryRoot = `${import.meta.dirname}/../../../..`;
    for (const dockerfile of [
      "services/api/Dockerfile",
      "docker/services/Dockerfile",
      "docker/standalone/Dockerfile",
    ]) {
      const content = await Bun.file(`${repositoryRoot}/${dockerfile}`).text();
      expect(content).toContain("packages/data-schemas/src");
    }

    const compose = await Bun.file(`${repositoryRoot}/deploy/compose.yaml`).text();
    expect(compose).toContain("condition: service_healthy");
  });
});

/*
 * Migrations are located by what they do rather than by their index, which
 * shifts whenever another migration lands ahead of them.
 */
const readMigrationContaining = async (needle: string): Promise<string> => {
  const drizzleDirectory = `${import.meta.dirname}/../../drizzle`;
  const journal = await Bun.file(`${drizzleDirectory}/meta/_journal.json`).json() as {
    entries: { idx: number; tag: string }[];
  };

  for (const { tag } of journal.entries) {
    const migration = await Bun.file(`${drizzleDirectory}/${tag}.sql`).text();
    if (migration.includes(needle)) {
      return migration;
    }
  }

  throw new Error(`Expected a migration containing ${needle}`);
};

const readIcalFeedsMigration = (): Promise<string> =>
  readMigrationContaining('CREATE TABLE IF NOT EXISTS "ical_feeds"');

describe("ical feed backfill migration", () => {
  it("backfills one default feed per user carrying their existing settings", async () => {
    const migration = await readIcalFeedsMigration();

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "ical_feeds"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "ical_feed_calendars"');
    expect(migration).toContain('INSERT INTO "ical_feeds"');
    expect(migration).toContain('FROM "user"');
    expect(migration).toContain('LEFT JOIN "ical_feed_settings"');
    expect(migration).not.toContain('FROM "ical_feed_settings"');
  });

  it("falls back to the synthesized defaults for users who never saved settings", async () => {
    const migration = await readIcalFeedsMigration();

    for (const field of [
      "includeEventName",
      "includeEventDescription",
      "includeEventLocation",
      "excludeAllDayEvents",
    ]) {
      expect(migration).toContain(`COALESCE(s."${field}", false)`);
    }
    expect(migration).toContain(`COALESCE(s."customEventName", 'Busy')`);
  });

  it("keeps every backfilled feed reachable by its old username url", async () => {
    const migration = await readIcalFeedsMigration();

    expect(migration).toContain('"legacyAlias"');
    expect(migration).toContain('"isDefault"');
  });

  it("materializes the current calendar selection without a capability filter", async () => {
    const migration = await readIcalFeedsMigration();

    expect(migration).toContain('INSERT INTO "ical_feed_calendars"');
    expect(migration).toContain('"includeInIcalFeed" = true');
    expect(migration).not.toContain("capabilities");
  });

  it("is idempotent and fails loud rather than silently skipping a user", async () => {
    const migration = await readIcalFeedsMigration();

    const inserts = migration.split('INSERT INTO "ical_feed').length - 1;
    expect(inserts).toBe(2);
    expect(migration.split("ON CONFLICT DO NOTHING").length - 1).toBe(2);
    expect(migration).toContain("RAISE EXCEPTION");
  });

  it("anchors the backfill and its verification against concurrent signups", async () => {
    const migration = await readIcalFeedsMigration();

    expect(migration.split("transaction_timestamp()").length - 1)
      .toBeGreaterThanOrEqual(2);
    expect(migration).toContain('u."createdAt" <= transaction_timestamp()');
    expect(migration).toContain("interval '1 minute'");
  });

  it("grace-bands both verification checks against concurrent writes", async () => {
    const migration = await readIcalFeedsMigration();

    expect(migration)
      .toContain(`u."createdAt" < transaction_timestamp() - interval '1 minute'`);
    expect(migration)
      .toContain(`c."createdAt" < transaction_timestamp() - interval '1 minute'`);
  });

  it("stays additive so a rolled-back api still serves the old feed", async () => {
    const migration = await readIcalFeedsMigration();

    expect(migration).not.toContain('DROP TABLE "ical_feed_settings"');
    expect(migration).not.toContain('DROP COLUMN "includeInIcalFeed"');
    expect(migration).not.toContain("SET NOT NULL");
  });

  /*
   * The migration runner replays the newest migration against databases that
   * already carry it, so every object it creates has to tolerate being created
   * twice.
   */
  it("re-applies cleanly against a database that already has the tables", async () => {
    const migration = await readIcalFeedsMigration();

    const creations = migration.match(/CREATE (?:UNIQUE )?(?:TABLE|INDEX) /g) ?? [];
    const guarded = migration.match(/CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS /g) ?? [];
    expect(creations).toHaveLength(guarded.length);

    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.includes("ADD CONSTRAINT")) {
        expect(statement).toContain("IF NOT EXISTS (");
        expect(statement).toContain("pg_constraint");
      }
    }
  });

  it("mints backfilled tokens without requiring pgcrypto", async () => {
    const migration = await readIcalFeedsMigration();

    expect(migration).toContain("gen_random_uuid()");
    expect(migration).toContain("'feed_'");
    expect(migration).not.toContain("gen_random_bytes");
    expect(migration).not.toContain("CREATE EXTENSION");
  });
});

const readPushChannelsMigration = (): Promise<string> =>
  readMigrationContaining('CREATE TABLE IF NOT EXISTS "calendar_push_channels"');

describe("push channels upgrade compatibility", () => {
  /* The runner replays the newest migration against databases that have it. */
  it("re-applies cleanly against a database that already has the table", async () => {
    const migration = await readPushChannelsMigration();

    const creations = migration.match(/CREATE (?:UNIQUE )?(?:TABLE|INDEX) /g) ?? [];
    const guarded = migration.match(/CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS /g) ?? [];
    expect(creations).toHaveLength(guarded.length);

    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.includes("ADD CONSTRAINT")) {
        expect(statement).toContain("IF NOT EXISTS (");
        expect(statement).toContain("pg_constraint");
      }
    }
  });

  it("stays additive so a rolled-back api keeps working", async () => {
    const migration = await readPushChannelsMigration();

    expect(migration).not.toContain("DROP TABLE");
    expect(migration).not.toContain("DROP COLUMN");
    expect(migration).not.toContain("SET NOT NULL");
  });
});

const readCalendarRediscoveryMigration = (): Promise<string> =>
  readMigrationContaining('ADD COLUMN IF NOT EXISTS "calendarsRefreshedAt"');

describe("calendar rediscovery upgrade compatibility", () => {
  it("adds the rediscovery columns as nullable and defaultless", async () => {
    const migration = await readCalendarRediscoveryMigration();

    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "unavailableSince" timestamp');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "calendarsRefreshedAt" timestamp');
    expect(migration)
      .toContain('ADD COLUMN IF NOT EXISTS "calendarsRefreshAttemptedAt" timestamp');
    expect(migration).not.toContain("DEFAULT");
  });

  /* The runner replays the newest migration against databases that have it. */
  it("re-applies cleanly against a database that already has the columns", async () => {
    const migration = await readCalendarRediscoveryMigration();

    const additions = migration.match(/ADD COLUMN /g) ?? [];
    const guarded = migration.match(/ADD COLUMN IF NOT EXISTS /g) ?? [];
    expect(additions).toHaveLength(guarded.length);
  });

  it("stays additive so old writers survive a rolling upgrade", async () => {
    const migration = await readCalendarRediscoveryMigration();

    expect(migration).not.toContain("SET NOT NULL");
    expect(migration).not.toContain('UPDATE "calendars"');
    expect(migration).not.toContain('UPDATE "calendar_accounts"');
    expect(migration).not.toContain("CREATE INDEX");
    expect(migration).not.toContain("CREATE UNIQUE INDEX");
    expect(migration).not.toContain("ADD CONSTRAINT");
    expect(migration).not.toContain("DROP COLUMN");
  });

  it("needs no backfill in the migration runner", async () => {
    const migrateScript = await Bun.file(
      `${import.meta.dirname}/../../scripts/migrate.ts`,
    ).text();

    expect(migrateScript).not.toContain("unavailableSince");
    expect(migrateScript).not.toContain("calendarsRefreshedAt");
    expect(migrateScript).not.toContain("calendarsRefreshAttemptedAt");
  });
});
