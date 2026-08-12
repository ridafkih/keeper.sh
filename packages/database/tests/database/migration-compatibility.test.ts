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

const readLatestMigration = async (): Promise<string> => {
  const drizzleDirectory = `${import.meta.dirname}/../../drizzle`;
  const journal = await Bun.file(`${drizzleDirectory}/meta/_journal.json`).json() as {
    entries: { idx: number; tag: string }[];
  };
  const latest = journal.entries.at(-1);
  if (!latest || latest.idx !== 77) {
    throw new Error("Expected migration 0077 to be the latest migration");
  }
  return Bun.file(`${drizzleDirectory}/${latest.tag}.sql`).text();
};

describe("0077 self-hosted upgrade compatibility", () => {
  it("keeps the generated migration additive and compatible with old writers", async () => {
    const migration = await readLatestMigration();

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
