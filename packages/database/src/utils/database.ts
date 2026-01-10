import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export const createDatabase = (url: string): PostgresJsDatabase => drizzle(postgres(url));
