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
const scratchName = `keeper_destination_paused_${process.pid}`;
const USER_ID = "destination-paused-user";
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

const {
  saveCalDAVDestinationWithDatabase,
  saveCalendarDestinationWithDatabase,
} = await import("../../src/utils/destinations");

interface SeededAccount {
  accountId: string;
  destinationCalendarId: string;
  sourceCalendarId: string;
}

const armedBackoff = {
  failureCount: 6,
  ingestFailureCount: 6,
  ingestLastFailureAt: ARMED_AT,
  ingestNextAttemptAt: PARKED_UNTIL,
  lastFailureAt: ARMED_AT,
  nextAttemptAt: PARKED_UNTIL,
};

const seedOAuthAccount = async (
  externalAccountId: string,
  destinationPaused: boolean,
): Promise<SeededAccount> => {
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
      disabled: destinationPaused,
      externalCalendarId: "keeper-destination",
      name: "Keeper destination",
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
      externalCalendarId: "work-calendar",
      name: "Work",
      userId: USER_ID,
      ...armedBackoff,
    })
    .returning({ id: calendarsTable.id });

  if (!credential || !account || !destination || !source) {
    throw new Error("Failed to seed the OAuth destination account");
  }

  await database.insert(sourceDestinationMappingsTable).values({
    destinationCalendarId: destination.id,
    sourceCalendarId: source.id,
  });

  return {
    accountId: account.id,
    destinationCalendarId: destination.id,
    sourceCalendarId: source.id,
  };
};

const seedCalDAVAccount = async (
  externalAccountId: string,
  destinationPaused: boolean,
): Promise<SeededAccount> => {
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
  const [destination] = await database
    .insert(calendarsTable)
    .values({
      accountId: account?.id ?? "",
      calendarType: "caldav",
      calendarUrl: "https://caldav.icloud.com/keeper",
      capabilities: ["pull", "push"],
      disabled: destinationPaused,
      name: "Keeper destination",
      userId: USER_ID,
      ...armedBackoff,
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
      ...armedBackoff,
    })
    .returning({ id: calendarsTable.id });

  if (!credential || !account || !destination || !source) {
    throw new Error("Failed to seed the CalDAV destination account");
  }

  await database.insert(sourceDestinationMappingsTable).values({
    destinationCalendarId: destination.id,
    sourceCalendarId: source.id,
  });

  return {
    accountId: account.id,
    destinationCalendarId: destination.id,
    sourceCalendarId: source.id,
  };
};

const readCalendar = async (calendarId: string) => {
  const [row] = await database
    .select({
      disabled: calendarsTable.disabled,
      failureCount: calendarsTable.failureCount,
      ingestFailureCount: calendarsTable.ingestFailureCount,
      ingestNextAttemptAt: calendarsTable.ingestNextAttemptAt,
      nextAttemptAt: calendarsTable.nextAttemptAt,
    })
    .from(calendarsTable)
    .where(eq(calendarsTable.id, calendarId))
    .limit(1);
  return row;
};

const reconnectOAuthDestination = (
  externalAccountId: string,
  needsReauthentication = false,
): Promise<void> =>
  saveCalendarDestinationWithDatabase(
    database as never,
    USER_ID,
    "google",
    externalAccountId,
    `${externalAccountId}@example.com`,
    "fresh-access-token",
    "fresh-refresh-token",
    new Date(PARKED_UNTIL.getTime() + 3_600_000),
    needsReauthentication,
  );

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

const readCalendarDisabled = async (calendarId: string): Promise<boolean | undefined> => {
  const row = await readCalendar(calendarId);
  return row?.disabled;
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
    values ('${USER_ID}', 'destination-paused@example.com', 'Destination Paused')
  `);
});

afterAll(async () => {
  if (!administrativeUrl) {
    return;
  }
  await client.end();
  await withAdministrativeClient([`drop database if exists "${scratchName}"`]);
});

describe.skipIf(!administrativeUrl)("reconnecting an OAuth destination account", () => {
  it("resumes a running destination calendar and clears both backoff clocks", async () => {
    const seeded = await seedOAuthAccount("oauth-running", false);

    await reconnectOAuthDestination("oauth-running");

    expect(await readCalendar(seeded.destinationCalendarId)).toMatchObject({
      disabled: false,
      failureCount: 0,
      ingestFailureCount: 0,
      ingestNextAttemptAt: null,
      nextAttemptAt: null,
    });
  });

  it("leaves a destination calendar the user paused on purpose paused", async () => {
    const seeded = await seedOAuthAccount("oauth-paused", true);

    await reconnectOAuthDestination("oauth-paused");

    expect(await readCalendarDisabled(seeded.destinationCalendarId)).toBe(true);
  });

  it("clears the paused destination's backoff without resuming it", async () => {
    const seeded = await seedOAuthAccount("oauth-paused-backoff", true);

    await reconnectOAuthDestination("oauth-paused-backoff");

    expect(await readCalendar(seeded.destinationCalendarId)).toMatchObject({
      disabled: true,
      failureCount: 0,
      ingestFailureCount: 0,
      ingestNextAttemptAt: null,
      nextAttemptAt: null,
    });
  });

  it("leaves a paused source calendar on the same account paused", async () => {
    const seeded = await seedOAuthAccount("oauth-paused-source", false);
    await database
      .update(calendarsTable)
      .set({ disabled: true })
      .where(eq(calendarsTable.id, seeded.sourceCalendarId));

    await reconnectOAuthDestination("oauth-paused-source");

    expect(await readCalendarDisabled(seeded.sourceCalendarId)).toBe(true);
  });

  it("keeps the pause across a replayed reconnect", async () => {
    const seeded = await seedOAuthAccount("oauth-paused-twice", true);

    await reconnectOAuthDestination("oauth-paused-twice");
    await reconnectOAuthDestination("oauth-paused-twice");

    expect(await readCalendarDisabled(seeded.destinationCalendarId)).toBe(true);
  });

  it("leaves a paused destination alone when the callback lacked the required scopes", async () => {
    const seeded = await seedOAuthAccount("oauth-paused-scopes", true);

    await reconnectOAuthDestination("oauth-paused-scopes", true);

    expect(await readCalendar(seeded.destinationCalendarId)).toMatchObject({
      disabled: true,
      ingestFailureCount: 6,
    });
  });
});

describe.skipIf(!administrativeUrl)("rotating the password of a CalDAV destination account", () => {
  it("resumes a running destination calendar and clears both backoff clocks", async () => {
    const seeded = await seedCalDAVAccount("caldav-running", false);

    await rotateCalDAVPassword("caldav-running");

    expect(await readCalendar(seeded.destinationCalendarId)).toMatchObject({
      disabled: false,
      failureCount: 0,
      ingestFailureCount: 0,
      ingestNextAttemptAt: null,
      nextAttemptAt: null,
    });
  });

  it("leaves a destination calendar the user paused on purpose paused", async () => {
    const seeded = await seedCalDAVAccount("caldav-paused", true);

    await rotateCalDAVPassword("caldav-paused");

    expect(await readCalendarDisabled(seeded.destinationCalendarId)).toBe(true);
  });

  it("keeps the pause across a replayed rotation", async () => {
    const seeded = await seedCalDAVAccount("caldav-paused-twice", true);

    await rotateCalDAVPassword("caldav-paused-twice");
    await rotateCalDAVPassword("caldav-paused-twice");

    expect(await readCalendarDisabled(seeded.destinationCalendarId)).toBe(true);
  });

  it("leaves a paused source calendar on the same account paused", async () => {
    const seeded = await seedCalDAVAccount("caldav-paused-source", false);
    await database
      .update(calendarsTable)
      .set({ disabled: true })
      .where(eq(calendarsTable.id, seeded.sourceCalendarId));

    await rotateCalDAVPassword("caldav-paused-source");

    expect(await readCalendarDisabled(seeded.sourceCalendarId)).toBe(true);
  });
});
