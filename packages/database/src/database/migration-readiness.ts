import { sql } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const MIGRATION_READINESS_POLL_MS = 1000;
const MIGRATION_READINESS_TIMEOUT_MS = 10 * 60 * 1000;

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

interface MigrationReadinessDatabase {
  isReady: () => Promise<boolean>;
}

const createMigrationReadinessDatabase = (
  database: BunSQLDatabase,
): MigrationReadinessDatabase => ({
  isReady: async () => {
    const result = await database.execute(sql`
      SELECT
        EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgrelid = to_regclass('public.event_mappings')
            AND tgname = 'event_mappings_compatibility_fill'
            AND NOT tgisinternal
        )
        AND EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = to_regclass('public.event_mappings')
            AND conname = 'event_mappings_eventStateId_event_states_id_fk'
            AND confdeltype = 'n'
            AND convalidated
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = to_regclass('public.event_mappings')
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
    const [state] = result as unknown as { ready: boolean }[];
    return state?.ready === true;
  },
});

const waitForDatabaseMigrations = async (
  database: MigrationReadinessDatabase,
  timeoutMs: number = MIGRATION_READINESS_TIMEOUT_MS,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await database.isReady()) {
      return;
    }
    await sleep(MIGRATION_READINESS_POLL_MS);
  }
  if (!(await database.isReady())) {
    throw new Error("Database migrations did not reach the required runtime state");
  }
};

export {
  createMigrationReadinessDatabase,
  waitForDatabaseMigrations,
};
export type { MigrationReadinessDatabase };
