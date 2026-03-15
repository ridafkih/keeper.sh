import type { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

interface DatabasePoolOptions {
  statementTimeoutMs?: number;
}

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

const appendStatementTimeout = (url: string, timeoutMs: number): string => {
  const parsed = new URL(url);
  parsed.searchParams.set("options", `-c statement_timeout=${timeoutMs}`);
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
  const connectionUrl = appendStatementTimeout(url, statementTimeoutMs);
  const database = drizzle(connectionUrl);
  await waitForConnection(database);
  return database;
};

const closeDatabase = (database: DatabaseInstance): void => {
  database.$client.close();
};

export { createDatabase, closeDatabase, DEFAULT_STATEMENT_TIMEOUT_MS };
export type { DatabasePoolOptions, DatabaseInstance };
