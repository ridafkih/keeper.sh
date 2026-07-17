import { sql, type SQL } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { BunSQLClient, BunSQLTransactionClient } from "../database-client";

const SOURCE_INGEST_LOCK_NAMESPACE = 9003;

interface IngestLockTransaction {
  execute(query: SQL): PromiseLike<unknown>;
}

const acquireSourceIngestLocks = async <
  TResult,
  TTransaction extends IngestLockTransaction,
>(
  transaction: TTransaction,
  calendarIds: string[],
  work: (lockedDatabase: TTransaction) => Promise<TResult>,
): Promise<TResult> => {
  // Provider I/O can legitimately exceed the pool's 30-second idle transaction timeout.
  // PostgreSQL must retain the transaction-owned advisory locks during remote work.
  await transaction.execute(sql`set local idle_in_transaction_session_timeout = 0`);
  for (const calendarId of calendarIds) {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${SOURCE_INGEST_LOCK_NAMESPACE}, hashtext(${calendarId}))`,
    );
  }
  return work(transaction);
};

const withSourceIngestLocks = <TResult>(
  database: BunSQLDatabase,
  calendarIds: string[],
  work: (lockedDatabase: BunSQLClient) => Promise<TResult>,
): Promise<TResult> => {
  const orderedCalendarIds = [...new Set(calendarIds)].toSorted();
  if (orderedCalendarIds.length === 0) {
    return work(database);
  }
  return database.transaction((transaction: BunSQLTransactionClient) =>
    acquireSourceIngestLocks(transaction, orderedCalendarIds, work));
};

const withSourceIngestLock = <TResult>(
  database: BunSQLDatabase,
  calendarId: string,
  work: (lockedDatabase: BunSQLClient) => Promise<TResult>,
): Promise<TResult> => withSourceIngestLocks(database, [calendarId], work);

export {
  SOURCE_INGEST_LOCK_NAMESPACE,
  acquireSourceIngestLocks,
  withSourceIngestLock,
  withSourceIngestLocks,
};
