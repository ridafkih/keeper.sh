import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { eq } from "drizzle-orm";
import {
  calendarAccountsTable,
  calendarsTable,
  oauthCredentialsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const scratchName = `keeper_duplicate_identity_${process.pid}`;
const USER_ID = "duplicate-identity-user";
const EMAIL = "shared@example.com";
const EXTERNAL_ACCOUNT_ID = "google-shared-identity";
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

const { saveCalendarDestinationWithDatabase } = await import("../../src/utils/destinations");
const { createOAuthSourceCredential } = await import("../../src/utils/oauth-source-credentials");

const armedColumns = {
  ingestFailureCount: 6,
  ingestLastFailureAt: ARMED_AT,
  ingestNextAttemptAt: PARKED_UNTIL,
};

interface SeededSourceAccount {
  accountId: string;
  credentialId: string;
  sourceCalendarId: string;
}

const seedSourceAccount = async (): Promise<SeededSourceAccount> => {
  const [credential] = await database
    .insert(oauthCredentialsTable)
    .values({
      accessToken: "dead-source-access-token",
      email: EMAIL,
      expiresAt: ARMED_AT,
      provider: "google",
      refreshToken: "dead-source-refresh-token",
      userId: USER_ID,
    })
    .returning({ id: oauthCredentialsTable.id });
  const [account] = await database
    .insert(calendarAccountsTable)
    .values({
      authType: "oauth",
      email: EMAIL,
      needsReauthentication: true,
      oauthCredentialId: credential?.id,
      provider: "google",
      userId: USER_ID,
    })
    .returning({ id: calendarAccountsTable.id });
  const [source] = await database
    .insert(calendarsTable)
    .values({
      accountId: account?.id ?? "",
      calendarType: "oauth",
      capabilities: ["pull"],
      externalCalendarId: "work-calendar",
      name: "Work",
      userId: USER_ID,
      ...armedColumns,
    })
    .returning({ id: calendarsTable.id });

  if (!credential || !account || !source) {
    throw new Error("Failed to seed the source account");
  }

  return { accountId: account.id, credentialId: credential.id, sourceCalendarId: source.id };
};

const connectDestination = (): Promise<void> =>
  saveCalendarDestinationWithDatabase(
    database as never,
    USER_ID,
    "google",
    EXTERNAL_ACCOUNT_ID,
    EMAIL,
    "destination-access-token",
    "destination-refresh-token",
    new Date("2026-08-13T10:00:00.000Z"),
  );

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

const readCredential = async (credentialId: string) => {
  const [row] = await database
    .select({ refreshToken: oauthCredentialsTable.refreshToken })
    .from(oauthCredentialsTable)
    .where(eq(oauthCredentialsTable.id, credentialId))
    .limit(1);
  return row;
};

const truncate = async (): Promise<void> => {
  await client.unsafe(`
    truncate table source_destination_mappings, calendars, calendar_accounts, oauth_credentials
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
    values ('${USER_ID}', '${EMAIL}', 'Duplicate Identity')
  `);
});

afterAll(async () => {
  if (!administrativeUrl) {
    return;
  }
  await client.end();
  await withAdministrativeClient([`drop database if exists "${scratchName}"`]);
});

describe.skipIf(!administrativeUrl)(
  "one Google identity connected as a source before it is connected as a destination",
  () => {
    it("puts the source and the destination on separate accounts and separate credential rows", async () => {
      await truncate();
      const source = await seedSourceAccount();

      await connectDestination();

      const accounts = await database
        .select({
          accountId: calendarAccountsTable.accountId,
          id: calendarAccountsTable.id,
          oauthCredentialId: calendarAccountsTable.oauthCredentialId,
        })
        .from(calendarAccountsTable);
      const credentials = await database
        .select({ id: oauthCredentialsTable.id })
        .from(oauthCredentialsTable);

      expect(accounts).toHaveLength(2);
      expect(credentials).toHaveLength(2);
      expect(accounts.map(({ id }) => id)).toContain(source.accountId);
    });

    it("keeps the destination reconnect scoped to its own account", async () => {
      await truncate();
      const source = await seedSourceAccount();
      await connectDestination();

      await connectDestination();

      expect(await readCalendar(source.sourceCalendarId)).toMatchObject({
        ingestFailureCount: 6,
        ingestNextAttemptAt: PARKED_UNTIL,
      });
      expect(await readAccountFlag(source.accountId)).toBe(true);
    });

    it("hands the reconnected tokens to the account the ingest cron actually reads", async () => {
      await truncate();
      const source = await seedSourceAccount();
      await connectDestination();

      await createOAuthSourceCredential(USER_ID, {
        accessToken: "fresh-access-token",
        email: EMAIL,
        expiresAt: new Date("2026-08-13T11:00:00.000Z"),
        provider: "google",
        refreshToken: "fresh-refresh-token",
      });

      expect(await readCredential(source.credentialId)).toMatchObject({
        refreshToken: "fresh-refresh-token",
      });
      expect(await readCalendar(source.sourceCalendarId)).toMatchObject({
        ingestFailureCount: 0,
        ingestNextAttemptAt: null,
      });
    });

    it("still reaches the source account when the cron refreshed its token first", async () => {
      await truncate();
      const source = await seedSourceAccount();
      await connectDestination();

      await database
        .update(oauthCredentialsTable)
        .set({ accessToken: "rotated-by-cron" })
        .where(eq(oauthCredentialsTable.id, source.credentialId));

      await createOAuthSourceCredential(USER_ID, {
        accessToken: "fresh-access-token",
        email: EMAIL,
        expiresAt: new Date("2026-08-13T11:00:00.000Z"),
        provider: "google",
        refreshToken: "fresh-refresh-token",
      });

      expect(await readCredential(source.credentialId)).toMatchObject({
        refreshToken: "fresh-refresh-token",
      });
      expect(await readAccountFlag(source.accountId)).toBe(false);
      expect(await readCalendar(source.sourceCalendarId)).toMatchObject({
        ingestFailureCount: 0,
        ingestNextAttemptAt: null,
      });
    });

    it("converges when the reconnect is replayed", async () => {
      await truncate();
      const source = await seedSourceAccount();
      await connectDestination();

      await createOAuthSourceCredential(USER_ID, {
        accessToken: "fresh-access-token",
        email: EMAIL,
        expiresAt: new Date("2026-08-13T11:00:00.000Z"),
        provider: "google",
        refreshToken: "fresh-refresh-token",
      });
      const afterFirst = await readCalendar(source.sourceCalendarId);
      await createOAuthSourceCredential(USER_ID, {
        accessToken: "fresh-access-token-2",
        email: EMAIL,
        expiresAt: new Date("2026-08-13T12:00:00.000Z"),
        provider: "google",
        refreshToken: "fresh-refresh-token-2",
      });
      const afterSecond = await readCalendar(source.sourceCalendarId);

      expect(afterFirst).toEqual(afterSecond);
      const credentials = await database
        .select({ id: oauthCredentialsTable.id })
        .from(oauthCredentialsTable);
      expect(credentials).toHaveLength(2);
    });

    it("does not leave an unmapped destination calendar behind for the ingest cron", async () => {
      await truncate();
      await seedSourceAccount();
      await connectDestination();

      const mappings = await database
        .select({ id: sourceDestinationMappingsTable.sourceCalendarId })
        .from(sourceDestinationMappingsTable);
      const destinationCalendars = await database
        .select({ capabilities: calendarsTable.capabilities, id: calendarsTable.id })
        .from(calendarsTable);

      expect(mappings).toHaveLength(0);
      expect(destinationCalendars).toHaveLength(2);
    });
  },
);
