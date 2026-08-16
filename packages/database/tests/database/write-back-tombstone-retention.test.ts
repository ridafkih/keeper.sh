import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const migrationScript = `${import.meta.dirname}/../../scripts/migrate.ts`;
const templateName = `keeper_tombstone_retention_template_${process.pid}`;
const scratchNames: string[] = [];

const withAdministrativeClient = async <Result>(
  run: (client: Client) => Promise<Result>,
): Promise<Result> => {
  const client = new Client({ connectionString: administrativeUrl });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
};

const withDatabaseClient = async <Result>(
  databaseName: string,
  run: (client: Client) => Promise<Result>,
): Promise<Result> => {
  const url = new URL(administrativeUrl ?? "postgres://localhost");
  url.pathname = `/${databaseName}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
};

const runMigrations = async (databaseName: string): Promise<void> => {
  const url = new URL(administrativeUrl ?? "postgres://localhost");
  url.pathname = `/${databaseName}`;
  const result = await Bun.$`bun ${migrationScript}`
    .env({ ...process.env, DATABASE_URL: url.toString() })
    .quiet()
    .nothrow();
  if (result.exitCode !== 0) {
    throw new Error(
      `Migration failed for ${databaseName}: ${result.stdout.toString()}${result.stderr.toString()}`,
    );
  }
};

const createScratchDatabase = async (label: string): Promise<string> => {
  const name = `keeper_tombstone_retention_${label}_${process.pid}`;
  scratchNames.push(name);
  await withAdministrativeClient(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
    await client.query(`CREATE DATABASE "${name}" TEMPLATE "${templateName}"`);
  });
  return name;
};

const USER_ID = "tombstone-user";
const RETENTION_MS = 30 * 86_400_000;

const seedTombstone = async (
  client: Client,
  expiresAt: Date,
): Promise<void> => {
  await client.query(
    `INSERT INTO "user" ("id", "email", "name") VALUES ($1, $2, $3)`,
    [USER_ID, `${USER_ID}@example.com`, "Tombstone Retention Fixture"],
  );
  await client.query(
    `INSERT INTO "event_write_back_tombstones"
       ("destinationCalendarId", "eventMappingId", "expiresAt", "observedAt",
        "snapshot", "sourceCalendarId", "sourceEventUid", "state", "userId")
     VALUES (gen_random_uuid(), gen_random_uuid(), $1, now(), $2,
             gen_random_uuid(), 'source-event-uid-1', 'applied', $3)`,
    [
      expiresAt,
      JSON.stringify({
        description: "Results and next steps",
        location: "Clinic",
        title: "Oncology follow-up",
      }),
      USER_ID,
    ],
  );
};

const countTombstones = async (client: Client): Promise<number> => {
  const result = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM "event_write_back_tombstones"`,
  );
  return Number(result.rows[0]?.total ?? "0");
};

describe.skipIf(!administrativeUrl)("what happens to a record of a deleted event", () => {
  beforeAll(async () => {
    await withAdministrativeClient(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${templateName}"`);
      await client.query(`CREATE DATABASE "${templateName}"`);
    });
    await runMigrations(templateName);
  }, 300_000);

  afterAll(async () => {
    await withAdministrativeClient(async (client) => {
      for (const name of [...scratchNames, templateName]) {
        await client.query(`DROP DATABASE IF EXISTS "${name}"`);
      }
    });
  }, 120_000);

  /*
   * The snapshot holds the title, description and location of an event the user chose to
   * delete. Deleting the account has to take it, whatever the retention window still says.
   */
  it("goes when the account goes", async () => {
    const databaseName = await createScratchDatabase("account_deleted");
    await withDatabaseClient(databaseName, async (client) => {
      await seedTombstone(client, new Date(Date.now() + RETENTION_MS));
      expect(await countTombstones(client)).toBe(1);

      await client.query(`DELETE FROM "user"`);

      expect(await countTombstones(client)).toBe(0);
    });
  }, 120_000);

  it("survives the calendar whose deletion it records", async () => {
    const databaseName = await createScratchDatabase("calendar_deleted");
    await withDatabaseClient(databaseName, async (client) => {
      await seedTombstone(client, new Date(Date.now() + RETENTION_MS));

      await client.query(`DELETE FROM "calendars"`);

      expect(await countTombstones(client)).toBe(1);
    });
  }, 120_000);
});
