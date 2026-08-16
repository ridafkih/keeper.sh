import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import {
  backfillEventMappingSyncEventIds,
  createEventMappingBackfillDatabase,
} from "../src/database/backfill-event-mapping-sync-event-ids";
import {
  backfillEventMappingSourceCalendarIds,
  createEventMappingSourceBackfillDatabase,
} from "../src/database/backfill-event-mapping-source-calendar-ids";
import {
  buildLegacyRecurringStateConsolidation,
  shouldConsolidateLegacyRecurringStates,
  type LegacyRecurringStateCompatibility,
} from "../src/database/legacy-recurring-state-consolidation";
import {
  DEFAULT_FUTURE_SYNC_RANGE,
  DEFAULT_HISTORIC_SYNC_RANGE,
  SYNC_RANGE_DEFINITIONS,
} from "@keeper.sh/data-schemas";

const MIGRATION_LOCK_TIMEOUT = "10s";

const connectionString = Bun.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing");
}

const connection = new Client({
  connectionString: connectionString,
});

const database = drizzle(connection);
await connection.connect();

const syncRangeSqlValues = SYNC_RANGE_DEFINITIONS
  .map(({ value }) => `'${value}'`)
  .join(", ");

const consolidateLegacyRecurringEventStates = async (): Promise<void> => {
  const compatibility = await connection.query<LegacyRecurringStateCompatibility>(`
    SELECT
      EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'event_states_identity_idx'
      ) AS has_legacy_index,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'event_states'
          AND column_name = 'recurrenceId'
      ) AS has_recurrence_column,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'event_states'
          AND column_name = 'sourceEventId'
      ) AS has_source_event_column,
      EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'event_states_recurring_instance_idx'
      ) AS has_recurring_index
  `);
  const [state = null] = compatibility.rows;
  if (!shouldConsolidateLegacyRecurringStates(state)) {
    return;
  }

  const statements = buildLegacyRecurringStateConsolidation(
    state.has_source_event_column,
  );

  await connection.query("BEGIN");
  try {
    for (const statement of statements) {
      await connection.query(statement);
    }
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  }
};

const installPreMigrationTombstoneProtection = async (): Promise<void> => {
  const state = await connection.query<{
    delete_action: string | null;
    event_state_nullable: boolean;
    has_event_mappings: boolean;
  }>(`
    SELECT
      to_regclass('public.event_mappings') IS NOT NULL AS has_event_mappings,
      COALESCE((
        SELECT is_nullable = 'YES'
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'event_mappings'
          AND column_name = 'eventStateId'
      ), false) AS event_state_nullable,
      (
        SELECT confdeltype::text
        FROM pg_constraint
        WHERE conname = 'event_mappings_eventStateId_event_states_id_fk'
          AND conrelid = to_regclass('public.event_mappings')
      ) AS delete_action
  `);
  const [mappingState] = state.rows;
  if (!mappingState?.has_event_mappings) {
    return;
  }
  if (mappingState.event_state_nullable && mappingState.delete_action === "n") {
    return;
  }

  await connection.query("BEGIN");
  try {
    await connection.query(`
      ALTER TABLE "event_mappings"
        ALTER COLUMN "eventStateId" DROP NOT NULL,
        DROP CONSTRAINT IF EXISTS "event_mappings_eventStateId_event_states_id_fk",
        ADD CONSTRAINT "event_mappings_eventStateId_event_states_id_fk"
          FOREIGN KEY ("eventStateId") REFERENCES "event_states"("id")
          ON DELETE SET NULL NOT VALID
    `);
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  }
};

const installEventMappingCompatibilityTrigger = async (): Promise<void> => {
  await connection.query(`
    CREATE OR REPLACE FUNCTION keeper_fill_event_mapping_compatibility()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      source_event_state_id uuid;
    BEGIN
      IF NEW."syncEventId" IS NULL AND NEW."eventStateId" IS NOT NULL THEN
        NEW."syncEventId" := cast(NEW."eventStateId" as text);
      END IF;
      source_event_state_id := NEW."eventStateId";
      IF source_event_state_id IS NULL AND TG_OP = 'UPDATE' THEN
        source_event_state_id := OLD."eventStateId";
      END IF;
      IF NEW."sourceCalendarId" IS NULL AND source_event_state_id IS NOT NULL THEN
        SELECT "calendarId"
        INTO NEW."sourceCalendarId"
        FROM "event_states"
        WHERE "id" = source_event_state_id;
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  const triggerState = await connection.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgrelid = 'event_mappings'::regclass
        AND tgname = 'event_mappings_compatibility_fill'
        AND NOT tgisinternal
    ) AS exists
  `);
  if (!triggerState.rows[0]?.exists) {
    await connection.query(`
      CREATE TRIGGER event_mappings_compatibility_fill
      BEFORE INSERT OR UPDATE OF "eventStateId", "syncEventId", "sourceCalendarId"
      ON "event_mappings"
      FOR EACH ROW
      EXECUTE FUNCTION keeper_fill_event_mapping_compatibility()
    `);
  }
};

const normalizeCalendarCoverage = async (): Promise<void> => {
  await connection.query(`
    UPDATE "calendars"
    SET "syncHistoricRange" = '${DEFAULT_HISTORIC_SYNC_RANGE}'
    WHERE "syncHistoricRange" NOT IN (${syncRangeSqlValues});
    UPDATE "calendars"
    SET "syncFutureRange" = '${DEFAULT_FUTURE_SYNC_RANGE}'
    WHERE "syncFutureRange" NOT IN (${syncRangeSqlValues});
    UPDATE "calendars"
    SET "ingestHistoricRange" = '${DEFAULT_HISTORIC_SYNC_RANGE}'
    WHERE "ingestHistoricRange" NOT IN (${syncRangeSqlValues});
    UPDATE "calendars"
    SET "ingestFutureRange" = '${DEFAULT_FUTURE_SYNC_RANGE}'
    WHERE "ingestFutureRange" NOT IN (${syncRangeSqlValues});
    UPDATE "calendars"
    SET
      "ingestWindowStart" = NULL,
      "ingestWindowEnd" = NULL,
      "ingestWindowRecordedAt" = NULL
    WHERE NOT (
      (
        "ingestWindowStart" IS NULL
        AND "ingestWindowEnd" IS NULL
        AND "ingestWindowRecordedAt" IS NULL
      ) OR (
        "ingestWindowStart" IS NOT NULL
        AND "ingestWindowEnd" IS NOT NULL
        AND "ingestWindowRecordedAt" IS NOT NULL
        AND "ingestWindowStart" < "ingestWindowEnd"
      )
    )
  `);
};

const installEventMappingConstraints = async (): Promise<void> => {
  const eventStateForeignKey = await connection.query<{
    delete_action: string;
  }>(`
    SELECT confdeltype::text AS delete_action
    FROM pg_constraint
    WHERE conname = 'event_mappings_eventStateId_event_states_id_fk'
      AND conrelid = 'event_mappings'::regclass
  `);
  if (eventStateForeignKey.rows[0]?.delete_action !== "n") {
    await connection.query(`
      ALTER TABLE "event_mappings"
        DROP CONSTRAINT IF EXISTS "event_mappings_eventStateId_event_states_id_fk",
        ADD CONSTRAINT "event_mappings_eventStateId_event_states_id_fk"
          FOREIGN KEY ("eventStateId") REFERENCES "event_states"("id")
          ON DELETE SET NULL NOT VALID
    `);
  }
  const sourceCalendarForeignKey = await connection.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'event_mappings_sourceCalendarId_calendars_id_fk'
        AND conrelid = 'event_mappings'::regclass
    ) AS exists
  `);
  if (sourceCalendarForeignKey.rows[0]?.exists) {
    // Historical source identity must survive source/calendar deletion until remote cleanup.
    await connection.query(`
      ALTER TABLE "event_mappings"
      DROP CONSTRAINT "event_mappings_sourceCalendarId_calendars_id_fk"
    `);
  }
  await connection.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'event_mappings_identity_check'
          AND conrelid = 'event_mappings'::regclass
      ) THEN
        ALTER TABLE "event_mappings"
          ADD CONSTRAINT "event_mappings_identity_check"
          CHECK ("eventStateId" IS NOT NULL OR "syncEventId" IS NOT NULL)
          NOT VALID;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'calendars_sync_ranges_check'
          AND conrelid = 'calendars'::regclass
      ) THEN
        ALTER TABLE "calendars"
          ADD CONSTRAINT "calendars_sync_ranges_check"
          CHECK (
            "syncHistoricRange" IN (${syncRangeSqlValues})
            AND "syncFutureRange" IN (${syncRangeSqlValues})
          ) NOT VALID;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'calendars_ingest_coverage_check'
          AND conrelid = 'calendars'::regclass
      ) THEN
        ALTER TABLE "calendars"
          ADD CONSTRAINT "calendars_ingest_coverage_check"
          CHECK (
            "ingestHistoricRange" IN (${syncRangeSqlValues})
            AND "ingestFutureRange" IN (${syncRangeSqlValues})
            AND (
              (
                "ingestWindowStart" IS NULL
                AND "ingestWindowEnd" IS NULL
                AND "ingestWindowRecordedAt" IS NULL
              ) OR (
                "ingestWindowStart" IS NOT NULL
                AND "ingestWindowEnd" IS NOT NULL
                AND "ingestWindowRecordedAt" IS NOT NULL
                AND "ingestWindowStart" < "ingestWindowEnd"
              )
            )
          ) NOT VALID;
      END IF;
    END
    $$
  `);
};

const validateEventMappingConstraints = async (): Promise<void> => {
  for (const [table, constraint] of [
    ["event_mappings", "event_mappings_eventStateId_event_states_id_fk"],
    ["event_mappings", "event_mappings_identity_check"],
    ["calendars", "calendars_sync_ranges_check"],
    ["calendars", "calendars_ingest_coverage_check"],
  ] as const) {
    /*
     * Postgres answers NULL from to_regclass for a table that does not exist yet, where
     * ::regclass throws. This runs before the migrator, on a database that may be empty.
     */
    const state = await connection.query<{ validated: boolean }>(`
      SELECT convalidated AS validated
      FROM pg_constraint
      WHERE conname = '${constraint}'
        AND conrelid = to_regclass('public.${table}')
    `);
    if (state.rows[0]?.validated === false) {
      await connection.query(
        `ALTER TABLE "${table}" VALIDATE CONSTRAINT "${constraint}"`,
      );
    }
  }
};

/*
 * CONCURRENTLY exists to wait for the transactions already reading the table, so the
 * session-wide lock_timeout the migration runs under is the one setting guaranteed to kill
 * it. A single reader older than the timeout aborts the build and leaves an invalid index
 * behind, and the repair is another CONCURRENTLY statement that the same timeout kills
 * again — so the failure sticks and blocks migration readiness for every later run. The
 * timeout is lifted for these statements alone and restored immediately after.
 */
const withoutLockTimeout = async (run: () => Promise<void>): Promise<void> => {
  await connection.query(`SET lock_timeout = 0`);
  try {
    await run();
  } finally {
    await connection.query(`SET lock_timeout = '${MIGRATION_LOCK_TIMEOUT}'`);
  }
};

const ensureSourceCalendarIndex = async (): Promise<void> => {
  const getIndexState = () => connection.query<{ valid: boolean }>(`
    SELECT index_state.indisvalid AS valid
    FROM pg_class index_class
    INNER JOIN pg_index index_state ON index_state.indexrelid = index_class.oid
    WHERE index_class.relname = 'event_mappings_source_calendar_idx'
      AND index_class.relnamespace = 'public'::regnamespace
  `);
  let state = await getIndexState();
  if (state.rows[0] && !state.rows[0].valid) {
    await withoutLockTimeout(async () => {
      await connection.query(`
        DROP INDEX CONCURRENTLY "event_mappings_source_calendar_idx"
      `);
    });
    state = await getIndexState();
  }
  if (!state.rows[0]) {
    await withoutLockTimeout(async () => {
      await connection.query(`
        CREATE INDEX CONCURRENTLY "event_mappings_source_calendar_idx"
        ON "event_mappings" ("sourceCalendarId")
      `);
    });
  }
  const verifiedState = await getIndexState();
  if (!verifiedState.rows[0]?.valid) {
    throw new Error("Event mapping source-calendar index is not valid");
  }
};

const isPostMigrationRuntimeReady = async (): Promise<boolean> => {
  const state = await connection.query<{ ready: boolean }>(`
    SELECT
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'event_mappings'::regclass
          AND tgname = 'event_mappings_compatibility_fill'
          AND NOT tgisinternal
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'event_mappings'::regclass
          AND conname = 'event_mappings_eventStateId_event_states_id_fk'
          AND confdeltype = 'n'
          AND convalidated
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'event_mappings'::regclass
          AND conname = 'event_mappings_sourceCalendarId_calendars_id_fk'
      )
      AND (
        SELECT count(*) = 3
        FROM pg_constraint
        WHERE conname IN (
          'event_mappings_identity_check',
          'calendars_sync_ranges_check',
          'calendars_ingest_coverage_check'
        )
          AND convalidated
      )
      AND EXISTS (
        SELECT 1
        FROM pg_class index_class
        INNER JOIN pg_index index_state ON index_state.indexrelid = index_class.oid
        WHERE index_class.relname = 'event_mappings_source_calendar_idx'
          AND index_class.relnamespace = 'public'::regnamespace
          AND index_state.indisvalid
      ) AS ready
  `);
  return state.rows[0]?.ready === true;
};

try {
  await connection.query(`
    SELECT pg_advisory_lock(hashtext('keeper.sh:database-migration'))
  `);
  await connection.query(`SET lock_timeout = '${MIGRATION_LOCK_TIMEOUT}'`);
  await connection.query(`SET statement_timeout = '30min'`);
  /*
   * The tombstone protection below commits on its own, outside the migrator's transaction,
   * so a migrate() that fails afterwards leaves the constraint installed and unvalidated
   * while drizzle's journal still describes the schema that preceded it. Validation is
   * otherwise only reachable after a successful run, which is exactly the run that did not
   * happen — so any constraint left NOT VALID by an earlier attempt is validated here,
   * before anything else is attempted.
   */
  await validateEventMappingConstraints();
  await installPreMigrationTombstoneProtection();
  await consolidateLegacyRecurringEventStates();

  const legacyMappingColumns = await connection.query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'event_mappings'
      AND column_name IN ('eventStateId', 'syncEventId')
  `);
  if (legacyMappingColumns.rowCount === 2) {
    await backfillEventMappingSyncEventIds(
      createEventMappingBackfillDatabase(database),
    );
  }

  try {
    await connection.query(`
      DELETE FROM drizzle.__drizzle_migrations
      WHERE created_at = 1767760000000
    `);
  } catch {
    /**
     * This is meant to remove a bad migration, if this fails - it just
     * means that the migrations have not yet been run. We can safely ignore.
     */
  }

  await migrate(database, {
    migrationsFolder: `${import.meta.dirname}/../drizzle`,
  });

  if (!(await isPostMigrationRuntimeReady())) {
    await installEventMappingCompatibilityTrigger();
    await backfillEventMappingSourceCalendarIds(
      createEventMappingSourceBackfillDatabase(database),
    );
    await backfillEventMappingSyncEventIds(
      createEventMappingBackfillDatabase(database),
    );
    await normalizeCalendarCoverage();
    await ensureSourceCalendarIndex();
    await installEventMappingConstraints();
    await validateEventMappingConstraints();
  }
} finally {
  // PostgreSQL releases the session-level migration lock when this client closes.
  await connection.end();
}
