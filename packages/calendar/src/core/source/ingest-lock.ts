import { sql, type SQL } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { BunSQLClient, BunSQLTransactionClient } from "../database-client";
import { INGEST_SOURCE_TIMEOUT_MS } from "@keeper.sh/constants";

const SOURCE_INGEST_LOCK_NAMESPACE = 9003;
const SOURCE_INGEST_LOCK_TIMEOUT_MS = 30_000;
const SOURCE_INGEST_IDLE_TIMEOUT_GRACE_MS = 5000;

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
  await transaction.execute(sql`select set_config(
    'statement_timeout',
    ${String(SOURCE_INGEST_LOCK_TIMEOUT_MS)},
    true
  )`);
  await transaction.execute(sql`select set_config(
    'idle_in_transaction_session_timeout',
    ${String(INGEST_SOURCE_TIMEOUT_MS + SOURCE_INGEST_IDLE_TIMEOUT_GRACE_MS)},
    true
  )`);
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
  SOURCE_INGEST_LOCK_TIMEOUT_MS,
  acquireSourceIngestLocks,
  withSourceIngestLock,
  withSourceIngestLocks,
};
