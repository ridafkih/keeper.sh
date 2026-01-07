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

await migrate(database, {
  migrationsFolder: join(import.meta.dirname, "..", "drizzle"),
})

await connection.end()
process.exit(0);
