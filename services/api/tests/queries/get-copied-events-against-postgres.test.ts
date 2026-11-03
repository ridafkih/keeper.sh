import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SQL } from "bun";
import { closeDatabase, createDatabase } from "@keeper.sh/database";
import { getCopiedEvents } from "../../src/queries/get-copied-events";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const migrationScript = `${import.meta.dirname}/../../../../packages/database/scripts/migrate.ts`;
const databaseName = `keeper_api_copied_events_${process.pid}`;
const NOW = new Date("2026-11-02T12:00:00Z");

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

describe.skipIf(!administrativeUrl)("counting copied events against Postgres", () => {
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

  it("counts each source event once, only through the user's current mappings", async () => {
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
        (${account?.id}::uuid, 'oauth', 'work', 'owner', ARRAY['pull', 'push']),
        (${account?.id}::uuid, 'oauth', 'personal', 'owner', ARRAY['pull', 'push']),
        (${account?.id}::uuid, 'oauth', 'family', 'owner', ARRAY['pull', 'push']),
        (${account?.id}::uuid, 'oauth', 'unmapped', 'owner', ARRAY['pull', 'push'])
      RETURNING "id", "name"
    `;
    const idOf = (name: string): string => calendars.find((calendar) => calendar.name === name)?.id ?? "";
    await client`
      INSERT INTO "source_destination_mappings" ("sourceCalendarId", "destinationCalendarId")
      VALUES
        (${idOf("work")}::uuid, ${idOf("personal")}::uuid),
        (${idOf("personal")}::uuid, ${idOf("work")}::uuid),
        (${idOf("work")}::uuid, ${idOf("family")}::uuid)
    `;
    const states = await client<{ id: string; title: string }[]>`
      INSERT INTO "event_states" ("calendarId", "startTime", "endTime", "title")
      VALUES
        (${idOf("work")}::uuid, '2026-11-03T15:00:00Z', '2026-11-03T16:00:00Z', 'Standup'),
        (${idOf("work")}::uuid, '2026-11-04T15:00:00Z', '2026-11-04T16:00:00Z', 'Review'),
        (${idOf("personal")}::uuid, '2026-11-05T18:00:00Z', '2026-11-05T19:00:00Z', 'Dentist')
      RETURNING "id", "title"
    `;
    const stateOf = (title: string): string => states.find((state) => state.title === title)?.id ?? "";
    await client`
      INSERT INTO "event_mappings"
        ("calendarId", "sourceCalendarId", "eventStateId", "syncEventId", "destinationEventUid", "startTime", "endTime")
      VALUES
        (${idOf("personal")}::uuid, ${idOf("work")}::uuid, ${stateOf("Standup")}::uuid, ${stateOf("Standup")}, 'copy-1', '2026-11-03T15:00:00Z', '2026-11-03T16:00:00Z'),
        (${idOf("family")}::uuid, ${idOf("work")}::uuid, ${stateOf("Standup")}::uuid, ${stateOf("Standup")}, 'copy-2', '2026-11-03T15:00:00Z', '2026-11-03T16:00:00Z'),
        (${idOf("personal")}::uuid, ${idOf("work")}::uuid, ${stateOf("Review")}::uuid, ${stateOf("Review")}, 'copy-3', '2026-11-04T15:00:00Z', '2026-11-04T16:00:00Z'),
        (${idOf("work")}::uuid, ${idOf("personal")}::uuid, ${stateOf("Dentist")}::uuid, ${stateOf("Dentist")}, 'copy-4', '2026-11-05T18:00:00Z', '2026-11-05T19:00:00Z'),
        (${idOf("unmapped")}::uuid, ${idOf("work")}::uuid, ${stateOf("Review")}::uuid, ${stateOf("Review")}, 'copy-5', '2026-11-04T15:00:00Z', '2026-11-04T16:00:00Z')
    `;

    const copies = await getCopiedEvents(database, "owner", 10, NOW);

    expect(copies.count).toBe(3);
    expect(copies.upcoming.map((copy) => copy.title)).toEqual(["Standup", "Review", "Dentist"]);
  });
});
