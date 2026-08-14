import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { eq } from "drizzle-orm";
import {
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import { encryptPassword } from "@keeper.sh/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncDestinationsForUser } from "../src/sync-user";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const scratchName = `keeper_dest_backoff_${process.pid}`;
const USER_ID = "destination-backoff-user";
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const PARKED_UNTIL = new Date("2026-08-12T09:00:00.000Z");
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const SEVENTH_STEP_MS = FIVE_MINUTES_MS * 2 ** 6;

const scratchUrl = (): string => {
  const url = new URL(administrativeUrl ?? "postgres://localhost");
  url.pathname = `/${scratchName}`;
  return url.toString();
};

const withAdministrativeClient = async (statements: string[]): Promise<void> => {
  const client = new SQL(administrativeUrl ?? "postgres://localhost");
  try {
    for (const statement of statements) {
      await client.unsafe(statement);
    }
  } finally {
    await client.end();
  }
};

let client: SQL = new SQL(administrativeUrl ?? "postgres://localhost");
let database: ReturnType<typeof drizzle> = drizzle(client);

const createSingleHolderRedis = () => ({
  get: () => Promise.resolve(null),
  eval: (script: string) => {
    if (script.includes("'blocked'")) {
      return Promise.resolve("acquired");
    }
    return Promise.resolve(1);
  },
  set: () => Promise.resolve("OK"),
});

interface UnauthorizedServer {
  url: string;
  requestCount: () => number;
  stop: () => Promise<void>;
}

const startUnauthorizedCalDAVServer = (
  onFirstRequest?: () => Promise<void>,
): UnauthorizedServer => {
  let requestCount = 0;
  const server = Bun.serve({
    port: 0,
    fetch: async () => {
      requestCount += 1;
      if (requestCount === 1 && onFirstRequest) {
        await onFirstRequest();
      }
      return new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": "Basic realm=\"caldav\"" },
      });
    },
  });

  return {
    requestCount: () => requestCount,
    stop: async () => {
      await server.stop(true);
    },
    url: `http://127.0.0.1:${server.port}`,
  };
};

const seedParkedDestination = async (serverUrl: string): Promise<{
  accountId: string;
  calendarId: string;
}> => {
  const [credential] = await database
    .insert(caldavCredentialsTable)
    .values({
      encryptedPassword: encryptPassword("revoked-app-password", ENCRYPTION_KEY),
      serverUrl,
      username: "person@icloud.com",
    })
    .returning({ id: caldavCredentialsTable.id });
  const [account] = await database
    .insert(calendarAccountsTable)
    .values({
      authType: "caldav",
      caldavCredentialId: credential?.id,
      needsReauthentication: true,
      provider: "icloud",
      userId: USER_ID,
    })
    .returning({ id: calendarAccountsTable.id });
  if (!account) {
    throw new Error("Failed to seed calendar account");
  }
  const [calendar] = await database
    .insert(calendarsTable)
    .values({
      accountId: account.id,
      calendarType: "caldav",
      calendarUrl: `${serverUrl}/calendars/person/keeper/`,
      capabilities: ["push"],
      failureCount: 6,
      lastFailureAt: PARKED_UNTIL,
      name: "Keeper",
      nextAttemptAt: PARKED_UNTIL,
      userId: USER_ID,
    })
    .returning({ id: calendarsTable.id });
  if (!calendar) {
    throw new Error("Failed to seed calendar");
  }
  return { accountId: account.id, calendarId: calendar.id };
};

const applyReconnect = async (accountId: string): Promise<void> => {
  await database
    .update(calendarAccountsTable)
    .set({ needsReauthentication: false })
    .where(eq(calendarAccountsTable.id, accountId));
  await database
    .update(calendarsTable)
    .set({
      failureCount: 0,
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
      lastFailureAt: null,
      nextAttemptAt: null,
    })
    .where(eq(calendarsTable.accountId, accountId));
};

const readCalendar = async (calendarId: string) => {
  const [row] = await database
    .select({
      failureCount: calendarsTable.failureCount,
      lastFailureAt: calendarsTable.lastFailureAt,
      nextAttemptAt: calendarsTable.nextAttemptAt,
    })
    .from(calendarsTable)
    .where(eq(calendarsTable.id, calendarId))
    .limit(1);
  return row;
};

const runPushSync = (calendarId: string) =>
  syncDestinationsForUser(USER_ID, {
    database: database as unknown as BunSQLDatabase,
    destinationCalendarId: calendarId,
    encryptionKey: ENCRYPTION_KEY,
    oauthConfig: {},
    plan: "pro",
    redis: createSingleHolderRedis() as never,
  });

const truncate = async (): Promise<void> => {
  await client.unsafe(`
    truncate table source_destination_mappings, calendars, calendar_accounts, caldav_credentials
    restart identity cascade
  `);
};

beforeAll(async () => {
  if (!administrativeUrl) {
    return;
  }

  await withAdministrativeClient([
    `drop database if exists "${scratchName}"`,
    `create database "${scratchName}"`,
  ]);

  const migrationScript = `${import.meta.dirname}/../../../packages/database/scripts/migrate.ts`;
  const migration = await Bun.$`bun ${migrationScript}`
    .env({ ...process.env, DATABASE_URL: scratchUrl() })
    .quiet()
    .nothrow();
  if (migration.exitCode !== 0) {
    throw new Error(`Migration failed: ${migration.stderr.toString()}`);
  }

  client = new SQL(scratchUrl());
  database = drizzle(client);

  await client.unsafe(`
    insert into "user" (id, email, name)
    values ('${USER_ID}', 'destination-backoff@example.com', 'Destination Backoff')
  `);
});

afterAll(async () => {
  if (!administrativeUrl) {
    return;
  }
  await client.end();
  await withAdministrativeClient([`drop database if exists "${scratchName}"`]);
});

describe.skipIf(!administrativeUrl)("a destination push run that fails on revoked credentials", () => {
  it("arms the next backoff step from the stored failure count", async () => {
    await truncate();
    const server = startUnauthorizedCalDAVServer();
    try {
      const { calendarId } = await seedParkedDestination(server.url);
      const before = Date.now();

      const result = await runPushSync(calendarId);

      expect(result.errors.join(" ")).toContain("Invalid credentials");
      const row = await readCalendar(calendarId);
      expect(row?.failureCount).toBe(7);
      expect(row?.nextAttemptAt?.getTime()).toBeGreaterThanOrEqual(before + SEVENTH_STEP_MS);
      expect(row?.nextAttemptAt?.getTime()).toBeLessThan(before + SIX_HOURS_MS);
    } finally {
      await server.stop();
    }
  });

  it("does not touch the provider while the stored window is still open", async () => {
    await truncate();
    const server = startUnauthorizedCalDAVServer();
    try {
      const { calendarId } = await seedParkedDestination(server.url);
      await database
        .update(calendarsTable)
        .set({ nextAttemptAt: new Date(Date.now() + SIX_HOURS_MS) })
        .where(eq(calendarsTable.id, calendarId));

      await runPushSync(calendarId);

      expect(server.requestCount()).toBe(0);
      const parked = await readCalendar(calendarId);
      expect(parked?.failureCount).toBe(6);
    } finally {
      await server.stop();
    }
  });
});

describe.skipIf(!administrativeUrl)("a password rotation that lands while the push run is in flight", () => {
  it("keeps the cleared backoff rather than parking the destination again", async () => {
    await truncate();
    let accountId = "";
    const server = startUnauthorizedCalDAVServer(async () => {
      await applyReconnect(accountId);
    });
    try {
      const seeded = await seedParkedDestination(server.url);
      ({ accountId } = seeded);

      await runPushSync(seeded.calendarId);

      expect(server.requestCount()).toBeGreaterThan(0);
      expect(await readCalendar(seeded.calendarId)).toMatchObject({
        failureCount: 0,
        lastFailureAt: null,
        nextAttemptAt: null,
      });
    } finally {
      await server.stop();
    }
  });

  it("never parks the reconnected destination past the first backoff step", async () => {
    await truncate();
    let accountId = "";
    const server = startUnauthorizedCalDAVServer(async () => {
      await applyReconnect(accountId);
    });
    try {
      const seeded = await seedParkedDestination(server.url);
      ({ accountId } = seeded);
      const before = Date.now();

      await runPushSync(seeded.calendarId);

      const row = await readCalendar(seeded.calendarId);
      const parkedForMs = (row?.nextAttemptAt?.getTime() ?? before) - before;
      expect(parkedForMs).toBeLessThanOrEqual(FIVE_MINUTES_MS);
    } finally {
      await server.stop();
    }
  });

  it("converges: a second run after the rotation does not compound the delay", async () => {
    await truncate();
    let accountId = "";
    const server = startUnauthorizedCalDAVServer(async () => {
      await applyReconnect(accountId);
    });
    try {
      const seeded = await seedParkedDestination(server.url);
      ({ accountId } = seeded);

      await runPushSync(seeded.calendarId);
      await database
        .update(calendarsTable)
        .set({ nextAttemptAt: null })
        .where(eq(calendarsTable.id, seeded.calendarId));
      const before = Date.now();
      await runPushSync(seeded.calendarId);

      const row = await readCalendar(seeded.calendarId);
      const parkedForMs = (row?.nextAttemptAt?.getTime() ?? before) - before;
      expect(parkedForMs).toBeLessThanOrEqual(FIVE_MINUTES_MS * 2);
    } finally {
      await server.stop();
    }
  });
});
