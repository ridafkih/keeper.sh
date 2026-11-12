import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SQL } from "bun";
import { closeDatabase, createDatabase } from "@keeper.sh/database";
import { createDatabaseFlush } from "../../../src/core/sync-engine/flush";
import type { PendingInsert } from "../../../src/core/sync-engine/types";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const migrationScript = `${import.meta.dirname}/../../../../database/scripts/migrate.ts`;
const databaseName = `keeper_calendar_flush_${process.pid}`;

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

const buildInsert = (
  fixture: { destinationId: string; sourceId: string },
  eventStateId: string,
): PendingInsert => ({
  calendarId: fixture.destinationId,
  deleteIdentifier: `delete-${eventStateId}`,
  destinationEventUid: `${eventStateId}@keeper.sh`,
  endTime: new Date("2026-03-15T10:00:00Z"),
  eventStateId,
  sourceCalendarId: fixture.sourceId,
  startTime: new Date("2026-03-15T09:00:00Z"),
  syncEventHash: null,
  syncEventId: eventStateId,
});

describe.skipIf(!administrativeUrl)("the mapping flush against Postgres", () => {
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

  it("records the copy of an event its source deleted mid-push, so the next sync can remove it", async () => {
    if (!client || !database) {
      throw new Error("database not ready");
    }
    await client`INSERT INTO "user" ("id", "email", "name") VALUES ('owner', 'owner@example.com', 'Owner')`;
    const [account] = await client<{ id: string }[]>`
      INSERT INTO "calendar_accounts" ("authType", "provider", "userId")
      VALUES ('oauth', 'google', 'owner') RETURNING "id"
    `;
    const [source, destination] = await client<{ id: string }[]>`
      INSERT INTO "calendars" ("accountId", "calendarType", "name", "userId")
      VALUES (${account?.id}::uuid, 'oauth', 'Source', 'owner'), (${account?.id}::uuid, 'oauth', 'Destination', 'owner')
      RETURNING "id"
    `;
    const fixture = { destinationId: destination?.id ?? "", sourceId: source?.id ?? "" };
    const [kept, deleted] = await client<{ id: string }[]>`
      INSERT INTO "event_states" ("calendarId", "startTime", "endTime")
      VALUES
        (${fixture.sourceId}::uuid, '2026-03-15T09:00:00Z', '2026-03-15T10:00:00Z'),
        (${fixture.sourceId}::uuid, '2026-03-16T09:00:00Z', '2026-03-16T10:00:00Z')
      RETURNING "id"
    `;
    await client`DELETE FROM "event_states" WHERE "id" = ${deleted?.id}::uuid`;

    await createDatabaseFlush(database)({
      deletes: [],
      inserts: [buildInsert(fixture, kept?.id ?? ""), buildInsert(fixture, deleted?.id ?? "")],
    });

    const mappings = await client<{ eventStateId: string | null; syncEventId: string }[]>`
      SELECT "eventStateId", "syncEventId" FROM "event_mappings" ORDER BY "startTime"
    `;
    expect([...mappings]).toEqual([
      { eventStateId: kept?.id, syncEventId: kept?.id },
      { eventStateId: null, syncEventId: deleted?.id },
    ]);
  });
});
