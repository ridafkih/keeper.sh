import { drizzle } from "drizzle-orm/bun-sql";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

export const createDatabase = (url: string): BunSQLDatabase => drizzle(url);
