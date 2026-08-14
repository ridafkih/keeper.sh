import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { eq } from "drizzle-orm";
import {
  calendarAccountsTable,
  calendarsTable,
  oauthCredentialsTable,
  sourceDestinationMappingsTable,
  syncStatusTable,
} from "@keeper.sh/database/schema";
import type { KeeperDatabase } from "../../src/types";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const scratchName = `keeper_reconnect_churn_${process.pid}`;
const USER_ID = "reconnect-churn-user";
const ARMED_AT = new Date("2026-08-13T04:00:00.000Z");
const PARKED_UNTIL = new Date("2026-08-13T09:30:00.000Z");

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

vi.mock("@/context", () => ({
  get database() {
    return database;
  },
  oauthProviders: {
    getProvider: () => null,
    hasRequiredScopes: () => true,
    isOAuthProvider: () => true,
    validateState: () => Promise.resolve(null),
  },
}));

vi.mock("@/utils/invalidate-calendars", () => ({
  getCalendarsAffectedByAccountMutation: () => Promise.resolve([]),
}));

vi.mock("../../src/utils/source-destination-mappings", () => ({
  requestUserSync: () => Promise.resolve(),
  scheduleMappingReplacementSync: () => Promise.resolve(),
  withMappingMutationLocks: (
    _database: unknown,
    _ids: unknown,
    callback: () => Promise<unknown>,
  ) => callback(),
}));

const enqueued: string[] = [];
vi.mock("@/utils/enqueue-push-sync", () => ({
  enqueuePushSync: (userId: string) => {
    enqueued.push(userId);
    return Promise.resolve();
  },
}));

const { saveCalendarDestinationWithDatabase } = await import("../../src/utils/destinations");
const { setCalendarPaused } = await import("../../src/utils/calendar-pause");
const { triggerSync } = await import("../../src/utils/trigger-sync");
const { clearSourceReauthentication } = await import(
  "../../src/utils/source-reauthentication"
);

const armedBackoff = {
  failureCount: 6,
  ingestFailureCount: 6,
  ingestLastFailureAt: ARMED_AT,
  ingestNextAttemptAt: PARKED_UNTIL,
  lastFailureAt: ARMED_AT,
  nextAttemptAt: PARKED_UNTIL,
};

interface Seeded {
  accountId: string;
  credentialId: string;
  destinationCalendarId: string;
  sourceCalendarId: string;
}

const seed = async (externalAccountId: string, paused = false): Promise<Seeded> => {
  const [credential] = await database
    .insert(oauthCredentialsTable)
    .values({
      accessToken: "dead-access-token",
      email: `${externalAccountId}@example.com`,
      expiresAt: ARMED_AT,
      provider: "google",
      refreshToken: "dead-refresh-token",
      userId: USER_ID,
    })
    .returning({ id: oauthCredentialsTable.id });
  const [account] = await database
    .insert(calendarAccountsTable)
    .values({
      accountId: externalAccountId,
      authType: "oauth",
      email: `${externalAccountId}@example.com`,
      needsReauthentication: true,
      oauthCredentialId: credential?.id,
      provider: "google",
      userId: USER_ID,
    })
    .returning({ id: calendarAccountsTable.id });
  const [destination] = await database
    .insert(calendarsTable)
    .values({
      accountId: account?.id ?? "",
      calendarType: "oauth",
      capabilities: ["pull", "push"],
      disabled: paused,
      externalCalendarId: "keeper-destination",
      name: "destination",
      userId: USER_ID,
      ...armedBackoff,
    })
    .returning({ id: calendarsTable.id });
  const [source] = await database
    .insert(calendarsTable)
    .values({
      accountId: account?.id ?? "",
      calendarType: "oauth",
      capabilities: ["pull"],
      externalCalendarId: "primary",
      name: "source",
      userId: USER_ID,
      ...armedBackoff,
    })
    .returning({ id: calendarsTable.id });

  await database.insert(sourceDestinationMappingsTable).values({
    destinationCalendarId: destination?.id ?? "",
    sourceCalendarId: source?.id ?? "",
  });

  if (!credential || !account || !destination || !source) {
    throw new Error("Failed to seed");
  }

  return {
    accountId: account.id,
    credentialId: credential.id,
    destinationCalendarId: destination.id,
    sourceCalendarId: source.id,
  };
};

const reconnectDestination = (
  externalAccountId: string,
  needsReauthentication = false,
  token = "fresh",
): Promise<void> =>
  saveCalendarDestinationWithDatabase(
    database as never,
    USER_ID,
    "google",
    externalAccountId,
    `${externalAccountId}@example.com`,
    `${token}-access-token`,
    `${token}-refresh-token`,
    new Date(PARKED_UNTIL.getTime() + 3_600_000),
    needsReauthentication,
  );

const readCalendar = async (calendarId: string) => {
  const [row] = await database
    .select({
      disabled: calendarsTable.disabled,
      failureCount: calendarsTable.failureCount,
      id: calendarsTable.id,
      ingestFailureCount: calendarsTable.ingestFailureCount,
      ingestLastFailureAt: calendarsTable.ingestLastFailureAt,
      ingestNextAttemptAt: calendarsTable.ingestNextAttemptAt,
      lastFailureAt: calendarsTable.lastFailureAt,
      nextAttemptAt: calendarsTable.nextAttemptAt,
    })
    .from(calendarsTable)
    .where(eq(calendarsTable.id, calendarId))
    .limit(1);
  return row;
};

const census = async () => {
  const [calendars] = await client.unsafe("select count(*)::int as n from calendars");
  const [accounts] = await client.unsafe("select count(*)::int as n from calendar_accounts");
  const [credentials] = await client.unsafe("select count(*)::int as n from oauth_credentials");
  const [statuses] = await client.unsafe("select count(*)::int as n from sync_status");
  const [mappings] = await client.unsafe(
    "select count(*)::int as n from source_destination_mappings",
  );
  return {
    accounts: accounts.n as number,
    calendars: calendars.n as number,
    credentials: credentials.n as number,
    mappings: mappings.n as number,
    statuses: statuses.n as number,
  };
};

const readFlag = async (accountId: string): Promise<boolean | undefined> => {
  const [row] = await database
    .select({ needsReauthentication: calendarAccountsTable.needsReauthentication })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.id, accountId))
    .limit(1);
  return row?.needsReauthentication;
};

const readSyncStatusIds = async (): Promise<string[]> => {
  const rows = await database
    .select({ calendarId: syncStatusTable.calendarId })
    .from(syncStatusTable);
  return rows.map(({ calendarId }) => calendarId).toSorted();
};

beforeAll(async () => {
  if (!administrativeUrl) {
    return;
  }

  await withAdministrativeClient([
    `drop database if exists "${scratchName}"`,
    `create database "${scratchName}"`,
  ]);

  const migrationScript = `${import.meta.dirname}/../../../../packages/database/scripts/migrate.ts`;
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
    values ('${USER_ID}', 'reconnect-churn@example.com', 'Reconnect Churn')
  `);
});

afterAll(async () => {
  if (!administrativeUrl) {
    return;
  }
  await client.end();
  await withAdministrativeClient([`drop database if exists "${scratchName}"`]);
});

describe.skipIf(!administrativeUrl)("replaying a destination reconnect ten times", () => {
  it("never creates or destroys a row", async () => {
    const seeded = await seed("churn-rows");
    await reconnectDestination("churn-rows", false, "warm-up");
    const before = await census();
    expect(before.statuses).toBe(1);
    const statusesBefore = await readSyncStatusIds();

    for (let round = 0; round < 10; round += 1) {
      await reconnectDestination("churn-rows", false, `round-${round}`);
    }

    expect(await census()).toEqual(before);
    expect(await readSyncStatusIds()).toEqual(statusesBefore);
    const destination = await readCalendar(seeded.destinationCalendarId);
    expect(destination?.id).toBe(seeded.destinationCalendarId);
  });

  it("settles on a single state instead of oscillating", async () => {
    const seeded = await seed("churn-settle");
    await reconnectDestination("churn-settle");
    const settled = await readCalendar(seeded.sourceCalendarId);

    for (let round = 0; round < 10; round += 1) {
      await reconnectDestination("churn-settle", false, `again-${round}`);
      expect(await readCalendar(seeded.sourceCalendarId)).toEqual(settled);
      expect(await readFlag(seeded.accountId)).toBe(false);
    }

    expect(settled).toMatchObject({
      failureCount: 0,
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
      lastFailureAt: null,
      nextAttemptAt: null,
    });
  });

  it("does not drift the armed clocks when the callback keeps lacking scopes", async () => {
    const seeded = await seed("churn-scopes");
    const before = await readCalendar(seeded.sourceCalendarId);

    for (let round = 0; round < 5; round += 1) {
      await reconnectDestination("churn-scopes", true, `noscope-${round}`);
    }

    expect(await readCalendar(seeded.sourceCalendarId)).toEqual(before);
    expect(await readFlag(seeded.accountId)).toBe(true);
  });
});

describe.skipIf(!administrativeUrl)("pausing and resuming in a loop", () => {
  it("converges to the same two states and never re-arms a cleared clock", async () => {
    const seeded = await seed("churn-pause");
    const states: unknown[] = [];

    for (let round = 0; round < 8; round += 1) {
      await setCalendarPaused(database as unknown as KeeperDatabase, USER_ID, seeded.sourceCalendarId, true);
      states.push(await readCalendar(seeded.sourceCalendarId));
      await setCalendarPaused(database as unknown as KeeperDatabase, USER_ID, seeded.sourceCalendarId, false);
      states.push(await readCalendar(seeded.sourceCalendarId));
    }

    const paused = states.filter((_state, index) => index % 2 === 0);
    const running = states.filter((_state, index) => index % 2 === 1);
    expect(new Set(paused.map((entry) => JSON.stringify(entry))).size).toBe(2);
    expect(new Set(running.map((entry) => JSON.stringify(entry))).size).toBe(1);
    expect(running[0]).toMatchObject({
      disabled: false,
      failureCount: 0,
      ingestFailureCount: 0,
      nextAttemptAt: null,
    });
  });
});

describe.skipIf(!administrativeUrl)("interleaving every recovery path a user can reach", () => {
  it("lands on one converged state no matter the order", async () => {
    const seeded = await seed("churn-interleave");

    await triggerSync(USER_ID, "premium" as never);
    await reconnectDestination("churn-interleave");
    await clearSourceReauthentication(database as unknown as KeeperDatabase, seeded.credentialId);
    await setCalendarPaused(database as unknown as KeeperDatabase, USER_ID, seeded.sourceCalendarId, false);
    const first = await readCalendar(seeded.sourceCalendarId);

    for (let round = 0; round < 6; round += 1) {
      await triggerSync(USER_ID, "premium" as never);
      await clearSourceReauthentication(database as unknown as KeeperDatabase, seeded.credentialId);
      await reconnectDestination("churn-interleave", false, `mix-${round}`);
      await setCalendarPaused(database as unknown as KeeperDatabase, USER_ID, seeded.sourceCalendarId, false);
      expect(await readCalendar(seeded.sourceCalendarId)).toEqual(first);
    }

    expect(first).toMatchObject({
      disabled: false,
      failureCount: 0,
      ingestFailureCount: 0,
      ingestNextAttemptAt: null,
      nextAttemptAt: null,
    });
  });

  it("reports nothing left to refresh once the first Sync now has run", async () => {
    await seed("churn-trigger");

    const first = await triggerSync(USER_ID, "premium" as never);
    const second = await triggerSync(USER_ID, "premium" as never);
    const third = await triggerSync(USER_ID, "premium" as never);

    expect(first.sourcesRefreshed).toBeGreaterThan(0);
    expect(second.sourcesRefreshed).toBe(0);
    expect(third.sourcesRefreshed).toBe(0);
  });

  it("leaves a paused calendar parked and paused through every path", async () => {
    const seeded = await seed("churn-paused", true);

    await triggerSync(USER_ID, "premium" as never);
    await reconnectDestination("churn-paused");
    await clearSourceReauthentication(database as unknown as KeeperDatabase, seeded.credentialId);

    expect(await readCalendar(seeded.destinationCalendarId)).toMatchObject({
      disabled: true,
    });
  });
});
