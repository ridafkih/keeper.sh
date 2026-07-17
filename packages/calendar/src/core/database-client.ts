import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

type BunSQLTransactionClient = Parameters<
  Parameters<BunSQLDatabase["transaction"]>[0]
>[0];

type BunSQLClient = BunSQLDatabase | BunSQLTransactionClient;

export type { BunSQLClient, BunSQLTransactionClient };
