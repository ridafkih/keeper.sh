import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SQL } from "bun";
import { closeDatabase, createDatabase } from "@keeper.sh/database";
import { readMappingSyncSummary } from "../../../src/core/sync/mapping-sync-state";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const migrationScript = `${import.meta.dirname}/../../../../database/scripts/migrate.ts`;
const databaseName = `keeper_calendar_mapping_state_${process.pid}`;

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

describe.skipIf(!administrativeUrl)("mapping sync state against Postgres", () => {
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

  it("counts mappings still waiting for their first sync apart from ones that are failing", async () => {
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
        (${account?.id}::uuid, 'oauth', 'waiting', 'owner', ARRAY['pull']),
        (${account?.id}::uuid, 'oauth', 'synced', 'owner', ARRAY['pull']),
        (${account?.id}::uuid, 'oauth', 'unreadable', 'owner', ARRAY['pull']),
        (${account?.id}::uuid, 'oauth', 'destination', 'owner', ARRAY['pull', 'push']),
        (${account?.id}::uuid, 'oauth', 'read-only', 'owner', ARRAY['pull'])
      RETURNING "id", "name"
    `;
    const idOf = (name: string): string => calendars.find((calendar) => calendar.name === name)?.id ?? "";
    await client`
      INSERT INTO "source_destination_mappings" ("sourceCalendarId", "destinationCalendarId", "firstSyncedAt")
      VALUES
        (${idOf("waiting")}::uuid, ${idOf("destination")}::uuid, NULL),
        (${idOf("synced")}::uuid, ${idOf("destination")}::uuid, now()),
        (${idOf("unreadable")}::uuid, ${idOf("destination")}::uuid, NULL),
        (${idOf("waiting")}::uuid, ${idOf("read-only")}::uuid, NULL)
    `;
    await client`
      UPDATE "source_ingest_schedule" SET "failureCount" = 3 WHERE "calendarId" = ${idOf("unreadable")}::uuid
    `;

    expect(await readMappingSyncSummary(database, "owner")).toEqual({ failingCount: 1, pendingCount: 1 });

    await client`
      UPDATE "source_destination_mappings" SET "firstSyncedAt" = now()
      WHERE "sourceCalendarId" = ${idOf("waiting")}::uuid
    `;

    expect(await readMappingSyncSummary(database, "owner")).toEqual({ failingCount: 1, pendingCount: 0 });
  });
});
