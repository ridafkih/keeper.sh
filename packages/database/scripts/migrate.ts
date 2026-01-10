import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { join } from "node:path";

const connectionString = Bun.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing");
}

const connection = new Client({
  connectionString: connectionString,
});

const database = drizzle(connection);
await connection.connect();

try {
  await connection.query(`
    DELETE FROM drizzle.__drizzle_migrations
    WHERE created_at = 1767760000000
  `);
} catch {
  /**
   * This is meant to remove a bad migration, if this fails - it just
   * means that the migrations have not yet been run. We can safely ignore.
   */
}

await migrate(database, {
  migrationsFolder: join(import.meta.dirname, "..", "drizzle"),
})

await connection.end()
process.exit(0);
