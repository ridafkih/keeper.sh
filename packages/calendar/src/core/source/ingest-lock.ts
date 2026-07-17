import { sql } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const SOURCE_INGEST_LOCK_NAMESPACE = 9003;

const withSourceIngestLocks = <TResult>(
  database: BunSQLDatabase,
  calendarIds: string[],
  work: () => Promise<TResult>,
): Promise<TResult> => {
  const orderedCalendarIds = [...new Set(calendarIds)].toSorted();
  if (orderedCalendarIds.length === 0) {
    return work();
  }
  return database.transaction(async (transaction) => {
    for (const calendarId of orderedCalendarIds) {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(${SOURCE_INGEST_LOCK_NAMESPACE}, hashtext(${calendarId}))`,
      );
    }
    return work();
  });
};

const withSourceIngestLock = <TResult>(
  database: BunSQLDatabase,
  calendarId: string,
  work: () => Promise<TResult>,
): Promise<TResult> => withSourceIngestLocks(database, [calendarId], work);

export { SOURCE_INGEST_LOCK_NAMESPACE, withSourceIngestLock, withSourceIngestLocks };
