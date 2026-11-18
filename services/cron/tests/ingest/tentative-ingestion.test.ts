import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SQL } from "bun";
import { eq } from "drizzle-orm";
import { closeDatabase, createDatabase } from "@keeper.sh/database";
import { calendarsTable } from "@keeper.sh/database/schema";
import {
  DESTINATION_EXCLUDES_TENTATIVE,
  requiresTentativeIngestion,
} from "../../src/ingest/tentative-ingestion";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const migrationScript = `${import.meta.dirname}/../../../../packages/database/scripts/migrate.ts`;
const databaseName = `keeper_cron_tentative_${process.pid}`;

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

describe("requiresTentativeIngestion", () => {
  it("is not required when nothing excludes tentative events", () => {
    expect(requiresTentativeIngestion({
      excludeAvailabilities: ["free"],
      excludesTentativeForADestination: false,
    })).toBe(false);
  });

  it("is required when the source calendar excludes tentative events", () => {
    expect(requiresTentativeIngestion({
      excludeAvailabilities: ["free", "tentative"],
      excludesTentativeForADestination: false,
    })).toBe(true);
  });

  it("is required when only one destination excludes tentative events", () => {
    expect(requiresTentativeIngestion({
      excludeAvailabilities: [],
      excludesTentativeForADestination: true,
    })).toBe(true);
  });

  it("falls back to the source calendar when the destination state is absent", () => {
    expect(requiresTentativeIngestion({ excludeAvailabilities: [] })).toBe(false);
    expect(requiresTentativeIngestion({
      excludeAvailabilities: [],
      excludesTentativeForADestination: null,
    })).toBe(false);
  });
});

describe.skipIf(!administrativeUrl)("destination tentative exclusion lookup", () => {
  const connections: Awaited<ReturnType<typeof createDatabase>>[] = [];
  const calendarIds = new Map<string, string>();

  const readFlag = async (name: string): Promise<boolean | null> => {
    const [database] = connections;
    const calendarId = calendarIds.get(name);
    if (!database || !calendarId) {
      throw new Error("The scratch database is not seeded");
    }
    const [row] = await database
      .select({ excludesTentativeForADestination: DESTINATION_EXCLUDES_TENTATIVE })
      .from(calendarsTable)
      .where(eq(calendarsTable.id, calendarId));
    return row?.excludesTentativeForADestination ?? null;
  };

  beforeAll(async () => {
    await withAdministrativeClient(async (client) => {
      await client.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await client.unsafe(`CREATE DATABASE "${databaseName}"`);
    });
    const migration = await Bun.$`bun ${migrationScript}`
      .env({ ...process.env, DATABASE_URL: buildDatabaseUrl(databaseName) })
      .quiet()
      .nothrow();
    if (migration.exitCode !== 0) {
      throw new Error(`Migration failed: ${migration.stderr.toString()}`);
    }

    const client = new SQL(buildDatabaseUrl(databaseName));
    try {
      await client`INSERT INTO "user" ("id", "email", "name") VALUES ('owner', 'owner@example.com', 'Owner')`;
      const [account] = await client<{ id: string }[]>`
        INSERT INTO "calendar_accounts" ("authType", "provider", "userId")
        VALUES ('oauth', 'outlook', 'owner') RETURNING "id"
      `;
      for (const name of ["plain", "overridden", "other-status", "unmapped", "destination"]) {
        const [calendar] = await client<{ id: string }[]>`
          INSERT INTO "calendars" ("accountId", "calendarType", "name", "userId")
          VALUES (${account?.id}::uuid, 'oauth', ${name}, 'owner') RETURNING "id"
        `;
        calendarIds.set(name, calendar?.id ?? "");
      }
      const destinationId = calendarIds.get("destination") ?? "";
      await client`
        INSERT INTO "source_destination_mappings" ("sourceCalendarId", "destinationCalendarId")
        VALUES (${calendarIds.get("plain") ?? ""}::uuid, ${destinationId}::uuid)
      `;
      await client`
        INSERT INTO "source_destination_mappings" ("sourceCalendarId", "destinationCalendarId", "excludeAvailabilities")
        VALUES (${calendarIds.get("overridden") ?? ""}::uuid, ${destinationId}::uuid, '{free,tentative}')
      `;
      await client`
        INSERT INTO "source_destination_mappings" ("sourceCalendarId", "destinationCalendarId", "excludeAvailabilities")
        VALUES (${calendarIds.get("other-status") ?? ""}::uuid, ${destinationId}::uuid, '{free}')
      `;
      await client`INSERT INTO "user" ("id", "email", "name") VALUES ('chain-owner', 'chain-owner@example.com', 'Chain Owner')`;
      const [chainAccount] = await client<{ id: string }[]>`
        INSERT INTO "calendar_accounts" ("authType", "provider", "userId")
        VALUES ('oauth', 'outlook', 'chain-owner') RETURNING "id"
      `;
      for (const name of ["upstream", "middle", "final"]) {
        const [calendar] = await client<{ id: string }[]>`
          INSERT INTO "calendars" ("accountId", "calendarType", "name", "userId")
          VALUES (${chainAccount?.id}::uuid, 'oauth', ${name}, 'chain-owner') RETURNING "id"
        `;
        calendarIds.set(name, calendar?.id ?? "");
      }
      await client`
        INSERT INTO "source_destination_mappings" ("sourceCalendarId", "destinationCalendarId")
        VALUES (${calendarIds.get("upstream") ?? ""}::uuid, ${calendarIds.get("middle") ?? ""}::uuid)
      `;
      await client`
        INSERT INTO "source_destination_mappings"
          ("sourceCalendarId", "destinationCalendarId", "excludeAvailabilities", "includeUpstreamSources")
        VALUES (${calendarIds.get("middle") ?? ""}::uuid, ${calendarIds.get("final") ?? ""}::uuid, '{tentative}', true)
      `;
    } finally {
      await client.close();
    }

    connections.push(await createDatabase(buildDatabaseUrl(databaseName), { maxConnections: 2 }));
  }, 300_000);

  afterAll(async () => {
    for (const connection of connections) {
      closeDatabase(connection, { graceSeconds: 1 });
    }
    await withAdministrativeClient(async (client) => {
      await client.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    });
  });

  it("is true for a source whose mapping excludes tentative events", async () => {
    expect(await readFlag("overridden")).toBe(true);
  });

  it("is false for a source whose mapping inherits its statuses", async () => {
    expect(await readFlag("plain")).toBe(false);
  });

  it("is false for a source whose mapping excludes only other statuses", async () => {
    expect(await readFlag("other-status")).toBe(false);
  });

  it("is false for a source with no mappings", async () => {
    expect(await readFlag("unmapped")).toBe(false);
  });

  it("is true for a source upstream of an opted-in link that excludes tentative events", async () => {
    expect(await readFlag("upstream")).toBe(true);
  });

  it("is false for another account's source when a stranger's link opted in", async () => {
    expect(await readFlag("plain")).toBe(false);
  });

  it("is false for a calendar that is only a destination", async () => {
    expect(await readFlag("destination")).toBe(false);
  });
});
