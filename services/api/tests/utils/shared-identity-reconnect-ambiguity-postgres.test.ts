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
const scratchName = `keeper_shared_identity_${process.pid}`;
const USER_ID = "shared-identity-user";
const SERVER_URL = "https://caldav.icloud.com";
const USERNAME = "person@icloud.com";
const EMAIL = "person@icloud.com";
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
  oauthProviders: {
    getProvider: () => null,
    hasRequiredScopes: () => true,
    isOAuthProvider: () => true,
    validateState: () => Promise.resolve(null),
  },
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

const caldavSourceData = (password: string, calendarUrl: string, name: string) => ({
  authMethod: "basic",
  calendarUrl,
  name,
  password,
  provider: "apple",
  serverUrl: SERVER_URL,
  username: USERNAME,
});

const readCalendar = async (calendarId: string) => {
  const [row] = await database
    .select({
      accountId: calendarsTable.accountId,
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

const readCredential = async (credentialId: string) => {
  const [row] = await database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      refreshToken: oauthCredentialsTable.refreshToken,
    })
    .from(oauthCredentialsTable)
    .where(eq(oauthCredentialsTable.id, credentialId))
    .limit(1);
  return row;
};

const flagAccount = async (accountId: string): Promise<void> => {
  await database
    .update(calendarAccountsTable)
    .set({ needsReauthentication: true })
    .where(eq(calendarAccountsTable.id, accountId));
};

const armCalendar = async (calendarId: string): Promise<void> => {
  await database
    .update(calendarsTable)
    .set(armedColumns)
    .where(eq(calendarsTable.id, calendarId));
};

interface SeededCalDAVIdentity {
  destinationAccountId: string;
  familyCalendarId: string;
  personalCalendarId: string;
  sourceAccountId: string;
}

// One identity connected as source then destination owns two account rows over the same serverUrl/username.
const seedCalDAVIdentity = async (): Promise<SeededCalDAVIdentity> => {
  const personal = await createCalDAVSource(
    USER_ID,
    caldavSourceData("live-app-password", `${SERVER_URL}/personal`, "Personal"),
  );
  const family = await createCalDAVSource(
    USER_ID,
    caldavSourceData("live-app-password", `${SERVER_URL}/family`, "Family"),
  );

  await saveCalDAVDestinationWithDatabase(
    database as never,
    USER_ID,
    "apple",
    EMAIL,
    EMAIL,
    SERVER_URL,
    `${SERVER_URL}/keeper`,
    USERNAME,
    "encrypted:live-app-password",
    "basic",
  );

  const [destinationAccount] = await database
    .select({ id: calendarAccountsTable.id })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.accountId, EMAIL))
    .limit(1);

  if (!destinationAccount) {
    throw new Error("Failed to seed the CalDAV destination account");
  }

  return {
    destinationAccountId: destinationAccount.id,
    familyCalendarId: family.source.id,
    personalCalendarId: personal.source.id,
    sourceAccountId: personal.source.accountId,
  };
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
    values ('${USER_ID}', '${GOOGLE_EMAIL}', 'Shared Identity')
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
  "one iCloud identity connected as a source and as a destination",
  () => {
    it("opens a second account row over the same server and username", async () => {
      const seeded = await seedCalDAVIdentity();

      const accounts = await database
        .select({ id: calendarAccountsTable.id })
        .from(calendarAccountsTable);

      expect(accounts).toHaveLength(2);
      expect(seeded.destinationAccountId).not.toBe(seeded.sourceAccountId);
    });

    it("rotates the password on the account that owns the calendar", async () => {
      const seeded = await seedCalDAVIdentity();
      await armCalendar(seeded.personalCalendarId);
      await armCalendar(seeded.familyCalendarId);
      await flagAccount(seeded.sourceAccountId);

      await createCalDAVSource(
        USER_ID,
        caldavSourceData("rotated-app-password", `${SERVER_URL}/personal`, "Personal"),
      );

      expect(await readAccountPassword(seeded.sourceAccountId))
        .toBe("encrypted:rotated-app-password");
    });

    // Flagging is per failing calendar; these counts are what put the destination account first in an unordered scan.
    it("still reconnects after the cron flagged both accounts for their failing calendars", async () => {
      const seeded = await seedCalDAVIdentity();
      await armCalendar(seeded.personalCalendarId);
      await armCalendar(seeded.familyCalendarId);
      await flagAccount(seeded.sourceAccountId);
      await flagAccount(seeded.destinationAccountId);
      await flagAccount(seeded.sourceAccountId);

      await createCalDAVSource(
        USER_ID,
        caldavSourceData("rotated-app-password", `${SERVER_URL}/personal`, "Personal"),
      );

      expect(await readAccountPassword(seeded.sourceAccountId))
        .toBe("encrypted:rotated-app-password");
      expect(await readAccountFlag(seeded.sourceAccountId)).toBe(false);
      expect(await readCalendar(seeded.personalCalendarId)).toMatchObject({
        ingestFailureCount: 0,
        ingestNextAttemptAt: null,
      });
    });

    it("unparks every calendar of the account the user just fixed", async () => {
      const seeded = await seedCalDAVIdentity();
      await armCalendar(seeded.personalCalendarId);
      await armCalendar(seeded.familyCalendarId);
      await flagAccount(seeded.sourceAccountId);
      await flagAccount(seeded.destinationAccountId);
      await flagAccount(seeded.sourceAccountId);

      await createCalDAVSource(
        USER_ID,
        caldavSourceData("rotated-app-password", `${SERVER_URL}/personal`, "Personal"),
      );

      expect(await readCalendar(seeded.familyCalendarId)).toMatchObject({
        ingestFailureCount: 0,
        ingestNextAttemptAt: null,
      });
    });

    it("converges when the user submits the same password twice", async () => {
      const seeded = await seedCalDAVIdentity();
      await armCalendar(seeded.personalCalendarId);
      await flagAccount(seeded.sourceAccountId);
      await flagAccount(seeded.destinationAccountId);
      await flagAccount(seeded.sourceAccountId);

      const first = await createCalDAVSource(
        USER_ID,
        caldavSourceData("rotated-app-password", `${SERVER_URL}/personal`, "Personal"),
      ).catch((error: unknown) => error);
      const second = await createCalDAVSource(
        USER_ID,
        caldavSourceData("rotated-app-password", `${SERVER_URL}/personal`, "Personal"),
      ).catch((error: unknown) => error);

      expect(second).toEqual(first);
      const accounts = await database
        .select({ id: calendarAccountsTable.id })
        .from(calendarAccountsTable);
      expect(accounts).toHaveLength(2);
    });
  },
);

interface SeededOAuthIdentity {
  destinationCredentialId: string;
  sourceAccountId: string;
  sourceCalendarId: string;
  sourceCredentialId: string;
}

const seedOAuthIdentity = async (): Promise<SeededOAuthIdentity> => {
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

  if (!sourceCredential || !sourceAccount || !sourceCalendar || !destinationCredential) {
    throw new Error("Failed to seed the Google identity");
  }

  return {
    destinationCredentialId: destinationCredential.id,
    sourceAccountId: sourceAccount.id,
    sourceCalendarId: sourceCalendar.id,
    sourceCredentialId: sourceCredential.id,
  };
};

// The indexed expiresAt column means this refresh relocates the row's index entry and flips unordered scan order.
const refreshSourceToken = async (credentialId: string): Promise<void> => {
  await database
    .update(oauthCredentialsTable)
    .set({
      accessToken: "cron-refreshed-access-token",
      expiresAt: new Date("2026-08-13T05:00:00.000Z"),
    })
    .where(eq(oauthCredentialsTable.id, credentialId));
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
  "one Google identity whose source credential the cron refreshed",
  () => {
    it("hands the reconnected grant to the credential the source account points at", async () => {
      const seeded = await seedOAuthIdentity();

      await refreshSourceToken(seeded.sourceCredentialId);

      await reconnectOAuthSource();

      expect(await readCredential(seeded.sourceCredentialId)).toMatchObject({
        refreshToken: "reconnected-refresh-token",
      });
    });

    it("resumes the parked source calendar after that refresh", async () => {
      const seeded = await seedOAuthIdentity();

      await refreshSourceToken(seeded.sourceCredentialId);

      await reconnectOAuthSource();

      expect(await readAccountFlag(seeded.sourceAccountId)).toBe(false);
      expect(await readCalendar(seeded.sourceCalendarId)).toMatchObject({
        ingestFailureCount: 0,
        ingestNextAttemptAt: null,
      });
    });

    it("does not overwrite the untouched destination grant instead", async () => {
      const seeded = await seedOAuthIdentity();

      await refreshSourceToken(seeded.sourceCredentialId);

      await reconnectOAuthSource();

      expect(await readCredential(seeded.destinationCredentialId)).toMatchObject({
        refreshToken: "destination-refresh-token",
      });
    });

    it("converges when the reconnect is replayed", async () => {
      const seeded = await seedOAuthIdentity();

      await refreshSourceToken(seeded.sourceCredentialId);

      const firstCredentialId = await reconnectOAuthSource();
      const secondCredentialId = await reconnectOAuthSource();

      expect(secondCredentialId).toBe(firstCredentialId);
      expect(await readCalendar(seeded.sourceCalendarId)).toMatchObject({
        ingestFailureCount: 0,
        ingestNextAttemptAt: null,
      });
    });
  },
);
