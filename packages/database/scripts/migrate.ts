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

import {
  describeNonUtcTimeZone,
  isUtcTimeZoneName,
} from "../src/database/migration-timezone";

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

/*
 * A guest list used to quarantine the whole pair, so one invited meeting stopped every other
 * event on that calendar from writing back. It is a permission the user can now give, and a
 * permission they have not given yet is no reason to distrust the pair: the state is cleared
 * so the pair resumes on the mode it still holds, and the meeting alone is held until the
 * grant arrives. Nothing is granted here — that answer is only the user's to give.
 *
 * Deliberately outside the readiness gate below: a database that already reports ready would
 * skip it, and the pairs stuck today are exactly the ones on such a database.
 */
const releasePairsHeldByTheGuestListRefusal = async (): Promise<void> => {
  await connection.query(`
    UPDATE "source_destination_mappings"
    SET "writeBackState" = 'ok', "writeBackStateReason" = NULL
    WHERE "writeBackState" = 'quarantined'
      AND "writeBackStateReason" = 'source_event_has_attendees'
  `);
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
        WHERE conname = 'event_mappings_destination_witness_check'
          AND conrelid = 'event_mappings'::regclass
      ) THEN
        ALTER TABLE "event_mappings"
          ADD CONSTRAINT "event_mappings_destination_witness_check"
          CHECK (
            "destinationContentHash" IS NULL
            OR (
              "destinationStartTime" IS NOT NULL
              AND "destinationEndTime" IS NOT NULL
              AND "destinationSummary" IS NOT NULL
              AND "destinationDescription" IS NOT NULL
              AND "destinationLocation" IS NOT NULL
              AND "destinationIsAllDay" IS NOT NULL
            )
          ) NOT VALID;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'event_mappings_pending_delete_check'
          AND conrelid = 'event_mappings'::regclass
      ) THEN
        ALTER TABLE "event_mappings"
          ADD CONSTRAINT "event_mappings_pending_delete_check"
          CHECK (("missingFirstObservedAt" IS NULL) = ("missingObservationCount" = 0))
          NOT VALID;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'source_destination_mappings_write_back_mode_check'
          AND conrelid = 'source_destination_mappings'::regclass
      ) THEN
        ALTER TABLE "source_destination_mappings"
          ADD CONSTRAINT "source_destination_mappings_write_back_mode_check"
          CHECK ("writeBackMode" IN ('off', 'edits', 'edits_and_deletes'))
          NOT VALID;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'source_destination_mappings_write_back_reach_check'
          AND conrelid = 'source_destination_mappings'::regclass
      ) THEN
        ALTER TABLE "source_destination_mappings"
          ADD CONSTRAINT "source_destination_mappings_write_back_reach_check"
          CHECK ("writeBackReach" IN (
            'own_events', 'my_meetings', 'my_meetings_notifying', 'any_event'
          ))
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
    ["event_mappings", "event_mappings_destination_witness_check"],
    ["event_mappings", "event_mappings_pending_delete_check"],
    ["source_destination_mappings", "source_destination_mappings_write_back_mode_check"],
    ["source_destination_mappings", "source_destination_mappings_write_back_reach_check"],
    ["calendars", "calendars_sync_ranges_check"],
    ["calendars", "calendars_ingest_coverage_check"],
  ] as const) {
    const state = await connection.query<{ validated: boolean }>(`
      SELECT convalidated AS validated
      FROM pg_constraint
      WHERE conname = '${constraint}'
        AND conrelid = '${table}'::regclass
    `);
    if (state.rows[0]?.validated === false) {
      await connection.query(
        `ALTER TABLE "${table}" VALIDATE CONSTRAINT "${constraint}"`,
      );
    }
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
    await connection.query(`
      DROP INDEX CONCURRENTLY "event_mappings_source_calendar_idx"
    `);
    state = await getIndexState();
  }
  if (!state.rows[0]) {
    await connection.query(`
      CREATE INDEX CONCURRENTLY "event_mappings_source_calendar_idx"
      ON "event_mappings" ("sourceCalendarId")
    `);
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
        SELECT count(*) = 7
        FROM pg_constraint
        WHERE conname IN (
          'event_mappings_identity_check',
          'event_mappings_destination_witness_check',
          'event_mappings_pending_delete_check',
          'source_destination_mappings_write_back_mode_check',
          'source_destination_mappings_write_back_reach_check',
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

const assertUtcServerTimeZone = async (): Promise<void> => {
  const state = await connection.query<{ TimeZone: string }>("SHOW TimeZone");
  const [row] = state.rows;
  if (isUtcTimeZoneName(row?.TimeZone)) {
    return;
  }
  throw new Error(describeNonUtcTimeZone(row?.TimeZone));
};

try {
  await connection.query(`
    SELECT pg_advisory_lock(hashtext('keeper.sh:database-migration'))
  `);
  await assertUtcServerTimeZone();
  /*
   * With the session in UTC a timestamp -> timestamptz change is binary-identical, so
   * Postgres records it as metadata and skips the table rewrite. The same ALTER under any
   * other zone rewrites every row while holding ACCESS EXCLUSIVE.
   */
  await connection.query(`SET TimeZone = 'UTC'`);
  await connection.query(`SET lock_timeout = '10s'`);
  await connection.query(`SET statement_timeout = '30min'`);
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

  await releasePairsHeldByTheGuestListRefusal();

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
