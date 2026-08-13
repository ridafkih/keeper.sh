import type { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { instrumentDatabasePool } from "./pool-telemetry";

interface DatabasePoolOptions {
  statementTimeoutMs?: number;
  idleInTransactionTimeoutMs?: number;
}

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000;
const POOL_MAX_CONNECTIONS = 10;
const POOL_IDLE_TIMEOUT_SECONDS = 30;
const POOL_MAX_LIFETIME_SECONDS = 1800;
/*
 * Bun 1.3.14 delivers one query's DataRows to a different query on the same
 * connection: an already-prepared query's Bind+Execute is written ahead of an
 * earlier queued-but-unwritten one while reply attribution stays FIFO, so every
 * reply shifts a position. Production saw a sync range column arrive holding the
 * return value of a set_config issued moments earlier on the same connection.
 * Reproduced at 500 wrong rows in 1000 against Postgres 16; oven-sh/bun#33627
 * fixes it but has not shipped in any release. Disabling prepared statements is
 * the only mitigation that held, and costs roughly 14% on a hot read.
 */
const PREPARED_STATEMENTS_ENABLED = false;

const appendServerSettings = (
  url: string,
  statementTimeoutMs: number,
  idleInTransactionTimeoutMs: number,
): string => {
  const parsed = new URL(url);
  parsed.searchParams.set(
    "options",
    `-c statement_timeout=${statementTimeoutMs} -c idle_in_transaction_session_timeout=${idleInTransactionTimeoutMs}`,
  );
  return parsed.toString();
};

interface DatabaseInstance extends BunSQLDatabase {
  $client: SQL;
}

const CONNECTION_RETRY_DELAY_MS = 500;
const CONNECTION_MAX_RETRIES = 10;

const waitForConnection = async (database: DatabaseInstance): Promise<void> => {
  for (let attempt = 0; attempt < CONNECTION_MAX_RETRIES; attempt++) {
    try {
      await database.execute("SELECT 1");
      return;
    } catch {
      if (attempt < CONNECTION_MAX_RETRIES - 1) {
        await Bun.sleep(CONNECTION_RETRY_DELAY_MS);
      }
    }
  }
  await database.execute("SELECT 1");
};

const createDatabase = async (url: string, options?: DatabasePoolOptions): Promise<DatabaseInstance> => {
  const statementTimeoutMs = options?.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  const idleInTransactionTimeoutMs =
    options?.idleInTransactionTimeoutMs ?? DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS;
  const connectionUrl = appendServerSettings(url, statementTimeoutMs, idleInTransactionTimeoutMs);
  const database = drizzle({
    connection: {
      url: connectionUrl,
      max: POOL_MAX_CONNECTIONS,
      idleTimeout: POOL_IDLE_TIMEOUT_SECONDS,
      maxLifetime: POOL_MAX_LIFETIME_SECONDS,
      prepare: PREPARED_STATEMENTS_ENABLED,
    },
  });
  instrumentDatabasePool(
    database.$client as unknown as Parameters<typeof instrumentDatabasePool>[0],
    POOL_MAX_CONNECTIONS,
  );
  await waitForConnection(database);
  return database;
};

const closeDatabase = (database: DatabaseInstance): void => {
  database.$client.close();
};

export { createDatabase, closeDatabase, DEFAULT_STATEMENT_TIMEOUT_MS };
export type { DatabasePoolOptions, DatabaseInstance };
