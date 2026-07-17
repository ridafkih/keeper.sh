import { sql } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const SOURCE_INGEST_LOCK_NAMESPACE = 9003;

const withSourceIngestLocks = <TResult>(
  database: BunSQLDatabase,
  calendarIds: string[],
  work: (lockedDatabase: BunSQLDatabase) => Promise<TResult>,
): Promise<TResult> => {
  const orderedCalendarIds = [...new Set(calendarIds)].toSorted();
  if (orderedCalendarIds.length === 0) {
    return work(database);
  }
  return database.transaction(async (transaction) => {
    // Provider I/O can legitimately exceed the pool's 30-second idle transaction timeout.
    // PostgreSQL must retain the transaction-owned advisory locks during remote work.
    await transaction.execute(sql`set local idle_in_transaction_session_timeout = 0`);
    for (const calendarId of orderedCalendarIds) {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(${SOURCE_INGEST_LOCK_NAMESPACE}, hashtext(${calendarId}))`,
      );
    }
    return work(transaction as unknown as BunSQLDatabase);
  });
};

const withSourceIngestLock = <TResult>(
  database: BunSQLDatabase,
  calendarId: string,
  work: (lockedDatabase: BunSQLDatabase) => Promise<TResult>,
): Promise<TResult> => withSourceIngestLocks(database, [calendarId], work);

export { SOURCE_INGEST_LOCK_NAMESPACE, withSourceIngestLock, withSourceIngestLocks };
