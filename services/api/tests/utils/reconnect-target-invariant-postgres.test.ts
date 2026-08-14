import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { eq } from "drizzle-orm";
import {
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const scratchName = `keeper_reconnect_target_${process.pid}`;
const USER_ID = "reconnect-target-user";
const SERVER_URL = "https://caldav.icloud.com";
const SOURCE_USERNAME = "person@icloud.com";
const DESTINATION_EMAIL = "person@icloud.com";
const GOOGLE_EMAIL = "person@example.com";
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
  encryptionKey: "0".repeat(64),
  premiumService: {
    getAccountLimit: () => 10,
    getUserPlan: () => Promise.resolve("pro"),
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

vi.mock("../../src/utils/enqueue-push-sync", () => ({
  enqueuePushSync: () => Promise.resolve(),
}));

vi.mock("@keeper.sh/database", () => ({
  encryptPassword: (password: string) => `encrypted:${password}`,
}));

const { createCalDAVSource } = await import("../../src/utils/caldav-sources");
const { saveCalDAVDestinationWithDatabase } = await import("../../src/utils/destinations");
const { createOAuthSourceCredential } = await import(
  "../../src/utils/oauth-source-credentials"
);

const armedColumns = {
  ingestFailureCount: 6,
  ingestLastFailureAt: ARMED_AT,
  ingestNextAttemptAt: PARKED_UNTIL,
};

const caldavSourceData = (password: string) => ({
  authMethod: "basic",
  calendarUrl: `${SERVER_URL}/personal`,
  name: "Personal",
  password,
  provider: "apple",
  serverUrl: SERVER_URL,
  username: SOURCE_USERNAME,
});

const connectDestination = (username: string): Promise<void> =>
  saveCalDAVDestinationWithDatabase(
    database as never,
    USER_ID,
    "apple",
    DESTINATION_EMAIL,
    DESTINATION_EMAIL,
    SERVER_URL,
    `${SERVER_URL}/keeper`,
    username,
    "encrypted:destination-app-password",
    "basic",
  );

const readAccountPassword = async (accountId: string): Promise<string | undefined> => {
  const [row] = await database
    .select({ encryptedPassword: caldavCredentialsTable.encryptedPassword })
    .from(calendarAccountsTable)
    .innerJoin(
      caldavCredentialsTable,
      eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id),
    )
    .where(eq(calendarAccountsTable.id, accountId))
    .limit(1);
  return row?.encryptedPassword;
};

const readAccountFlag = async (accountId: string): Promise<boolean | undefined> => {
  const [row] = await database
    .select({ needsReauthentication: calendarAccountsTable.needsReauthentication })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.id, accountId))
    .limit(1);
  return row?.needsReauthentication;
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

const readCredential = async (credentialId: string) => {
  const [row] = await database
    .select({ refreshToken: oauthCredentialsTable.refreshToken })
    .from(oauthCredentialsTable)
    .where(eq(oauthCredentialsTable.id, credentialId))
    .limit(1);
  return row;
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
    values ('${USER_ID}', '${GOOGLE_EMAIL}', 'Reconnect Target')
  `);
});

afterAll(async () => {
  if (!administrativeUrl) {
    return;
  }
  await client.end();
  await withAdministrativeClient([`drop database if exists "${scratchName}"`]);
});

beforeEach(async () => {
  if (!administrativeUrl) {
    return;
  }
  await client.unsafe("delete from sync_status");
  await client.unsafe("delete from calendars");
  await client.unsafe("delete from calendar_accounts");
  await client.unsafe("delete from caldav_credentials");
  await client.unsafe("delete from oauth_credentials");
});

describe.skipIf(!administrativeUrl)(
  "a CalDAV source whose identity an older destination account also matches",
  () => {
    it("rotates the password on the account that owns the calendar", async () => {
      await connectDestination("other@icloud.com");
      const source = await createCalDAVSource(USER_ID, caldavSourceData("live-app-password"));
      await connectDestination(SOURCE_USERNAME);
      await database
        .update(calendarsTable)
        .set(armedColumns)
        .where(eq(calendarsTable.id, source.source.id));
      await database
        .update(calendarAccountsTable)
        .set({ needsReauthentication: true })
        .where(eq(calendarAccountsTable.id, source.source.accountId));

      await createCalDAVSource(USER_ID, caldavSourceData("rotated-app-password"));

      expect(await readAccountPassword(source.source.accountId))
        .toBe("encrypted:rotated-app-password");
      expect(await readAccountFlag(source.source.accountId)).toBe(false);
      expect(await readCalendar(source.source.id)).toMatchObject({
        ingestFailureCount: 0,
        ingestNextAttemptAt: null,
      });
    });
  },
);

interface SeededOAuthIdentity {
  destinationCredentialId: string;
  sourceAccountId: string;
  sourceCalendarId: string;
  sourceCredentialId: string;
}

const seedOAuthIdentityWithOlderDestination = async (): Promise<SeededOAuthIdentity> => {
  const [destinationCredential] = await database
    .insert(oauthCredentialsTable)
    .values({
      accessToken: "destination-access-token",
      email: GOOGLE_EMAIL,
      expiresAt: ARMED_AT,
      provider: "google",
      refreshToken: "destination-refresh-token",
      userId: USER_ID,
    })
    .returning({ id: oauthCredentialsTable.id });
  await database
    .insert(calendarAccountsTable)
    .values({
      accountId: "google-destination-account",
      authType: "oauth",
      email: GOOGLE_EMAIL,
      oauthCredentialId: destinationCredential?.id,
      provider: "google",
      userId: USER_ID,
    });
  const [sourceCredential] = await database
    .insert(oauthCredentialsTable)
    .values({
      accessToken: "source-access-token",
      email: GOOGLE_EMAIL,
      expiresAt: ARMED_AT,
      provider: "google",
      refreshToken: "dead-source-refresh-token",
      userId: USER_ID,
    })
    .returning({ id: oauthCredentialsTable.id });
  const [sourceAccount] = await database
    .insert(calendarAccountsTable)
    .values({
      authType: "oauth",
      email: GOOGLE_EMAIL,
      needsReauthentication: true,
      oauthCredentialId: sourceCredential?.id,
      provider: "google",
      userId: USER_ID,
    })
    .returning({ id: calendarAccountsTable.id });
  const [sourceCalendar] = await database
    .insert(calendarsTable)
    .values({
      accountId: sourceAccount?.id ?? "",
      calendarType: "oauth",
      capabilities: ["pull"],
      externalCalendarId: "work-calendar",
      name: "Work",
      userId: USER_ID,
      ...armedColumns,
    })
    .returning({ id: calendarsTable.id });

  if (!destinationCredential || !sourceCredential || !sourceAccount || !sourceCalendar) {
    throw new Error("Failed to seed the Google identity");
  }

  return {
    destinationCredentialId: destinationCredential.id,
    sourceAccountId: sourceAccount.id,
    sourceCalendarId: sourceCalendar.id,
    sourceCredentialId: sourceCredential.id,
  };
};

const reconnectOAuthSource = (): Promise<string> =>
  createOAuthSourceCredential(USER_ID, {
    accessToken: "reconnected-access-token",
    email: GOOGLE_EMAIL,
    expiresAt: new Date("2026-08-13T11:00:00.000Z"),
    provider: "google",
    refreshToken: "reconnected-refresh-token",
  });

describe.skipIf(!administrativeUrl)(
  "an OAuth source whose destination credential row is the older one",
  () => {
    it("hands the reconnected grant to the credential the source account points at", async () => {
      const seeded = await seedOAuthIdentityWithOlderDestination();

      await reconnectOAuthSource();

      expect(await readCredential(seeded.sourceCredentialId)).toMatchObject({
        refreshToken: "reconnected-refresh-token",
      });
      expect(await readCredential(seeded.destinationCredentialId)).toMatchObject({
        refreshToken: "destination-refresh-token",
      });
    });

    it("resumes the parked source calendar", async () => {
      const seeded = await seedOAuthIdentityWithOlderDestination();

      await reconnectOAuthSource();

      expect(await readAccountFlag(seeded.sourceAccountId)).toBe(false);
      expect(await readCalendar(seeded.sourceCalendarId)).toMatchObject({
        ingestFailureCount: 0,
        ingestNextAttemptAt: null,
      });
    });
  },
);
