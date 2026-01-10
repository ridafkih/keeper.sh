import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { join } from "node:path";

const connectionString = Bun.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing");
}

const connection = postgres(connectionString, { max: 1 });
const database = drizzle(connection);

await connection`
  DELETE FROM drizzle.__drizzle_migrations
  WHERE created_at = 1767760000000
`;

await migrate(database, {
  migrationsFolder: join(import.meta.dirname, "..", "drizzle"),
});

await connection.end();
process.exit(0);
