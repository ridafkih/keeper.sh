import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SQL } from "bun";
import { closeDatabase, createDatabase } from "@keeper.sh/database";
import { recordFirstSyncedMappings } from "../src/first-sync";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const migrationScript = `${import.meta.dirname}/../../database/scripts/migrate.ts`;
const databaseName = `keeper_sync_first_sync_${process.pid}`;

const buildDatabaseUrl = (name: string): string => {
  const url = new URL(administrativeUrl ?? "postgres://localhost");
  url.pathname = `/${name}`;
  return url.toString();
};

const withAdministrativeClient = async (run: (client: SQL) => Promise<void>): Promise<void> => {
  const client = new SQL(administrativeUrl ?? "");
  try {
    await run(client);
  } finally {
    await client.close();
  }
};

describe.skipIf(!administrativeUrl)("recording first syncs against Postgres", () => {
  let client: SQL | null = null;
  let database: Awaited<ReturnType<typeof createDatabase>> | null = null;

  beforeAll(async () => {
    await withAdministrativeClient(async (admin) => {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    });
    const migrated = await Bun.$`bun ${migrationScript}`
      .env({ ...process.env, DATABASE_URL: buildDatabaseUrl(databaseName) })
      .quiet()
      .nothrow();
    if (migrated.exitCode !== 0) {
      throw new Error(`Migration failed: ${migrated.stderr.toString()}`);
    }
    client = new SQL(buildDatabaseUrl(databaseName));
    database = await createDatabase(buildDatabaseUrl(databaseName), { maxConnections: 2 });
  }, 300_000);

  afterAll(async () => {
    if (database) {
      closeDatabase(database, { graceSeconds: 1 });
    }
    await client?.close();
    await withAdministrativeClient(async (admin) => {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    });
  }, 120_000);

  it("marks only the mappings into this destination that had not completed a first sync", async () => {
    if (!client || !database) {
      throw new Error("database not ready");
    }
    await client`INSERT INTO "user" ("id", "email", "name") VALUES ('owner', 'owner@example.com', 'Owner')`;
    const [account] = await client<{ id: string }[]>`
      INSERT INTO "calendar_accounts" ("authType", "provider", "userId")
      VALUES ('oauth', 'google', 'owner') RETURNING "id"
    `;
    const calendars = await client<{ id: string; name: string }[]>`
      INSERT INTO "calendars" ("accountId", "calendarType", "name", "userId", "capabilities")
      VALUES
        (${account?.id}::uuid, 'oauth', 'new', 'owner', ARRAY['pull']),
        (${account?.id}::uuid, 'oauth', 'old', 'owner', ARRAY['pull']),
        (${account?.id}::uuid, 'oauth', 'destination', 'owner', ARRAY['pull', 'push']),
        (${account?.id}::uuid, 'oauth', 'elsewhere', 'owner', ARRAY['pull', 'push'])
      RETURNING "id", "name"
    `;
    const idOf = (name: string): string => calendars.find((calendar) => calendar.name === name)?.id ?? "";
    await client`
      INSERT INTO "source_destination_mappings" ("sourceCalendarId", "destinationCalendarId", "firstSyncedAt")
      VALUES
        (${idOf("new")}::uuid, ${idOf("destination")}::uuid, NULL),
        (${idOf("old")}::uuid, ${idOf("destination")}::uuid, '2026-01-01T00:00:00Z'),
        (${idOf("new")}::uuid, ${idOf("elsewhere")}::uuid, NULL)
    `;

    const recorded = await recordFirstSyncedMappings(database, idOf("destination"), [idOf("new"), idOf("old")]);

    expect(recorded).toEqual([idOf("new")]);
    const unsynced = await client<{ destinationCalendarId: string }[]>`
      SELECT "destinationCalendarId" FROM "source_destination_mappings" WHERE "firstSyncedAt" IS NULL
    `;
    expect([...unsynced]).toEqual([{ destinationCalendarId: idOf("elsewhere") }]);
  });
});
