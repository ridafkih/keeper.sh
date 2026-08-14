import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { eq } from "drizzle-orm";
import {
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarsTable,
  oauthCredentialsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const scratchName = `keeper_destination_reconnect_${process.pid}`;
const USER_ID = "destination-reconnect-user";
const ARMED_AT = new Date("2026-08-13T04:00:00.000Z");
const REARMED_AT = new Date("2026-08-13T09:30:00.000Z");

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

const {
  saveCalDAVDestinationWithDatabase,
  saveCalendarDestinationWithDatabase,
} = await import("../../src/utils/destinations");

interface SeededAccount {
  accountId: string;
  credentialId: string;
  destinationCalendarId: string;
  sourceCalendarId: string;
}

const seedSharedAccount = async (externalAccountId: string): Promise<SeededAccount> => {
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
  const backoff = {
    failureCount: 6,
    ingestFailureCount: 6,
    ingestLastFailureAt: ARMED_AT,
    ingestNextAttemptAt: REARMED_AT,
    lastFailureAt: ARMED_AT,
    nextAttemptAt: REARMED_AT,
  };
  const [destination] = await database
    .insert(calendarsTable)
    .values({
      accountId: account?.id ?? "",
      calendarType: "oauth",
      capabilities: ["pull", "push"],
      externalCalendarId: "keeper-destination",
      name: "Keeper destination",
      userId: USER_ID,
      ...backoff,
    })
    .returning({ id: calendarsTable.id });
  const [source] = await database
    .insert(calendarsTable)
    .values({
      accountId: account?.id ?? "",
      calendarType: "oauth",
      capabilities: ["pull"],
      externalCalendarId: "work-calendar",
      name: "Work",
      userId: USER_ID,
      ...backoff,
    })
    .returning({ id: calendarsTable.id });

  if (!credential || !account || !destination || !source) {
    throw new Error("Failed to seed the shared OAuth account");
  }

  await database.insert(sourceDestinationMappingsTable).values({
    destinationCalendarId: destination.id,
    sourceCalendarId: source.id,
  });

  return {
    accountId: account.id,
    credentialId: credential.id,
    destinationCalendarId: destination.id,
    sourceCalendarId: source.id,
  };
};

const readCalendar = async (calendarId: string) => {
  const [row] = await database
    .select({
      ingestFailureCount: calendarsTable.ingestFailureCount,
      ingestNextAttemptAt: calendarsTable.ingestNextAttemptAt,
    })
    .from(calendarsTable)
    .where(eq(calendarsTable.id, calendarId))
    .limit(1);
  return row;
};

const readAccountFlag = async (accountId: string): Promise<boolean | undefined> => {
  const [row] = await database
    .select({ needsReauthentication: calendarAccountsTable.needsReauthentication })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.id, accountId))
    .limit(1);
  return row?.needsReauthentication;
};

const reconnectDestination = (externalAccountId: string): Promise<void> =>
  saveCalendarDestinationWithDatabase(
    database as never,
    USER_ID,
    "google",
    externalAccountId,
    `${externalAccountId}@example.com`,
    "fresh-access-token",
    "fresh-refresh-token",
    new Date(REARMED_AT.getTime() + 3_600_000),
  );

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
    values ('${USER_ID}', 'destination-reconnect@example.com', 'Destination Reconnect')
  `);
});

afterAll(async () => {
  if (!administrativeUrl) {
    return;
  }
  await client.end();
  await withAdministrativeClient([`drop database if exists "${scratchName}"`]);
});

describe.skipIf(!administrativeUrl)("reconnecting an account that is both source and destination", () => {
  it("clears the reauthentication marker on the shared account", async () => {
    const seeded = await seedSharedAccount("shared-flag");

    await reconnectDestination("shared-flag");

    expect(await readAccountFlag(seeded.accountId)).toBe(false);
  });

  it("clears the destination calendar's backoff", async () => {
    const seeded = await seedSharedAccount("shared-destination");

    await reconnectDestination("shared-destination");

    expect(await readCalendar(seeded.destinationCalendarId)).toMatchObject({
      ingestFailureCount: 0,
      ingestNextAttemptAt: null,
    });
  });

  it("clears the ingest backoff of the source calendars the same credential feeds", async () => {
    const seeded = await seedSharedAccount("shared-source");

    await reconnectDestination("shared-source");

    expect(await readCalendar(seeded.sourceCalendarId)).toMatchObject({
      ingestFailureCount: 0,
      ingestNextAttemptAt: null,
    });
  });

  it("keeps the backoff armed when the callback came back without the required scopes", async () => {
    const seeded = await seedSharedAccount("shared-missing-scopes");

    await saveCalendarDestinationWithDatabase(
      database as never,
      USER_ID,
      "google",
      "shared-missing-scopes",
      "shared-missing-scopes@example.com",
      "fresh-access-token",
      "fresh-refresh-token",
      new Date(REARMED_AT.getTime() + 3_600_000),
      true,
    );

    expect(await readAccountFlag(seeded.accountId)).toBe(true);
    expect(await readCalendar(seeded.sourceCalendarId)).toMatchObject({
      ingestFailureCount: 6,
      ingestNextAttemptAt: REARMED_AT,
    });
    expect(await readCalendar(seeded.destinationCalendarId)).toMatchObject({
      ingestFailureCount: 6,
      ingestNextAttemptAt: REARMED_AT,
    });
  });

  it("stays cleared when the user reconnects twice", async () => {
    const seeded = await seedSharedAccount("shared-twice");

    await reconnectDestination("shared-twice");
    await reconnectDestination("shared-twice");

    expect(await readAccountFlag(seeded.accountId)).toBe(false);
    expect(await readCalendar(seeded.sourceCalendarId)).toMatchObject({
      ingestFailureCount: 0,
      ingestNextAttemptAt: null,
    });
  });
});

const seedSharedCalDAVAccount = async (externalAccountId: string): Promise<SeededAccount> => {
  const [credential] = await database
    .insert(caldavCredentialsTable)
    .values({
      encryptedPassword: "revoked-app-password",
      serverUrl: "https://caldav.icloud.com",
      username: `${externalAccountId}@icloud.com`,
    })
    .returning({ id: caldavCredentialsTable.id });
  const [account] = await database
    .insert(calendarAccountsTable)
    .values({
      accountId: externalAccountId,
      authType: "caldav",
      caldavCredentialId: credential?.id,
      email: `${externalAccountId}@icloud.com`,
      needsReauthentication: true,
      provider: "apple",
      userId: USER_ID,
    })
    .returning({ id: calendarAccountsTable.id });
  const backoff = {
    ingestFailureCount: 6,
    ingestLastFailureAt: ARMED_AT,
    ingestNextAttemptAt: REARMED_AT,
  };
  const [destination] = await database
    .insert(calendarsTable)
    .values({
      accountId: account?.id ?? "",
      calendarType: "caldav",
      calendarUrl: "https://caldav.icloud.com/keeper",
      capabilities: ["pull", "push"],
      name: "Keeper destination",
      userId: USER_ID,
      ...backoff,
    })
    .returning({ id: calendarsTable.id });
  const [source] = await database
    .insert(calendarsTable)
    .values({
      accountId: account?.id ?? "",
      calendarType: "caldav",
      calendarUrl: "https://caldav.icloud.com/personal",
      capabilities: ["pull"],
      name: "Personal",
      userId: USER_ID,
      ...backoff,
    })
    .returning({ id: calendarsTable.id });

  if (!credential || !account || !destination || !source) {
    throw new Error("Failed to seed the shared CalDAV account");
  }

  await database.insert(sourceDestinationMappingsTable).values({
    destinationCalendarId: destination.id,
    sourceCalendarId: source.id,
  });

  return {
    accountId: account.id,
    credentialId: credential.id,
    destinationCalendarId: destination.id,
    sourceCalendarId: source.id,
  };
};

const rotateCalDAVPassword = (externalAccountId: string): Promise<void> =>
  saveCalDAVDestinationWithDatabase(
    database as never,
    USER_ID,
    "apple",
    externalAccountId,
    `${externalAccountId}@icloud.com`,
    "https://caldav.icloud.com",
    "https://caldav.icloud.com/keeper",
    `${externalAccountId}@icloud.com`,
    "fresh-app-password",
    "basic",
  );

describe.skipIf(!administrativeUrl)("rotating the password of a shared CalDAV account", () => {
  it("clears the destination calendar's backoff", async () => {
    const seeded = await seedSharedCalDAVAccount("caldav-destination");

    await rotateCalDAVPassword("caldav-destination");

    expect(await readCalendar(seeded.destinationCalendarId)).toMatchObject({
      ingestFailureCount: 0,
      ingestNextAttemptAt: null,
    });
  });

  it("clears the ingest backoff of the source calendars on the same credential", async () => {
    const seeded = await seedSharedCalDAVAccount("caldav-source");

    await rotateCalDAVPassword("caldav-source");

    expect(await readCalendar(seeded.sourceCalendarId)).toMatchObject({
      ingestFailureCount: 0,
      ingestNextAttemptAt: null,
    });
  });

  it("clears the reauthentication marker the ingest job raised", async () => {
    const seeded = await seedSharedCalDAVAccount("caldav-flag");

    await rotateCalDAVPassword("caldav-flag");

    expect(await readAccountFlag(seeded.accountId)).toBe(false);
  });
});
