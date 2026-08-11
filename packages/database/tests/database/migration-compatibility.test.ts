import { describe, expect, it } from "vitest";

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

  it("consolidates recurring states on databases that predate the sourceEventId column", async () => {
    const migrateScript = await Bun.file(
      `${import.meta.dirname}/../../scripts/migrate.ts`,
    ).text();

    /*
     * Databases at 0070-0074 have no sourceEventId column. Referencing it
     * unguarded aborts migration with 42703, and skipping consolidation instead
     * lets 0076 fail building its unique index over the duplicates consolidation
     * exists to remove. Either way the API entrypoint crash-loops under set -e.
     */
    expect(migrateScript).toContain("column_name = 'sourceEventId'");
    expect(migrateScript).toContain("has_source_event_column");

    const guardStart = migrateScript.indexOf("const [state] = compatibility.rows;");
    const guard = migrateScript.slice(
      guardStart,
      migrateScript.indexOf("return;", guardStart),
    );
    expect(guard).toContain("has_recurring_index");
    expect(guard).not.toContain("has_source_event_column");
  });

  it("walks the source-calendar backfill with a keyset cursor", async () => {
    const backfillSource = await Bun.file(
      `${import.meta.dirname}/../../src/database/backfill-event-mapping-source-calendar-ids.ts`,
    ).text();

    /*
     * Without a cursor every batch rescans the rows it already filled, and the
     * supporting index is only created after the backfill runs — quadratic work
     * that can outlast the compose healthcheck window and strand the stack.
     */
    expect(backfillSource).toContain("lastId");
    expect(backfillSource).toContain("gt(");
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
    expect(migrateScript).toContain("keeper_recurring_state_consolidation");
    expect(migrateScript.indexOf("installPreMigrationTombstoneProtection()"))
      .toBeLessThan(migrateScript.indexOf("await migrate(database"));
    expect(migrateScript).toContain('ALTER COLUMN "eventStateId" DROP NOT NULL');
    expect(migrateScript).toContain("mapping_rank > 1");
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
