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

const createDatabase = (url: string, options?: DatabasePoolOptions): DatabaseInstance => {
  const statementTimeoutMs = options?.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  const connectionUrl = appendStatementTimeout(url, statementTimeoutMs);
  const database = drizzle(connectionUrl);

  return database;
};

const closeDatabase = (database: DatabaseInstance): void => {
  database.$client.close();
};

export { createDatabase, closeDatabase, DEFAULT_STATEMENT_TIMEOUT_MS };
export type { DatabasePoolOptions, DatabaseInstance };
