import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { count, eq } from "drizzle-orm";
import {
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const scratchName = `keeper_caldav_reconnect_${process.pid}`;
const USER_ID = "caldav-reconnect-user";
const SERVER_URL = "https://caldav.icloud.com";
const USERNAME = "person@icloud.com";
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
  encryptionKey: "0".repeat(64),
  premiumService: {
    getAccountLimit: () => 10,
    getUserPlan: () => Promise.resolve("pro"),
  },
}));

vi.mock("../../src/utils/enqueue-push-sync", () => ({
  enqueuePushSync: () => Promise.resolve(),
}));

vi.mock("@keeper.sh/database", () => ({
  encryptPassword: (password: string) => `encrypted:${password}`,
}));

const { createCalDAVSource, DuplicateCalDAVSourceError } = await import(
  "../../src/utils/caldav-sources"
);

const sourceData = (overrides: Record<string, string> = {}) => ({
  authMethod: "basic",
  calendarUrl: "https://caldav.icloud.com/personal",
  name: "Personal",
  password: "fresh-app-password",
  provider: "apple",
  serverUrl: SERVER_URL,
  username: USERNAME,
  ...overrides,
});

interface SeededSource {
  accountId: string;
  calendarId: string;
  credentialId: string;
  secondCalendarId: string;
}

const seedFailedSource = async (): Promise<SeededSource> => {
  const [credential] = await database
    .insert(caldavCredentialsTable)
    .values({
      encryptedPassword: "encrypted:revoked-app-password",
      serverUrl: SERVER_URL,
      username: USERNAME,
    })
    .returning({ id: caldavCredentialsTable.id });
  const [account] = await database
    .insert(calendarAccountsTable)
    .values({
      authType: "caldav",
      caldavCredentialId: credential?.id,
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
  const [calendar] = await database
    .insert(calendarsTable)
    .values({
      accountId: account?.id ?? "",
      calendarType: "caldav",
      calendarUrl: "https://caldav.icloud.com/personal",
      capabilities: ["pull", "push"],
      name: "Personal",
      userId: USER_ID,
      ...backoff,
    })
    .returning({ id: calendarsTable.id });
  const [second] = await database
    .insert(calendarsTable)
    .values({
      accountId: account?.id ?? "",
      calendarType: "caldav",
      calendarUrl: "https://caldav.icloud.com/family",
      capabilities: ["pull"],
      name: "Family",
      userId: USER_ID,
      ...backoff,
    })
    .returning({ id: calendarsTable.id });

  if (!credential || !account || !calendar || !second) {
    throw new Error("Failed to seed the CalDAV source");
  }

  return {
    accountId: account.id,
    calendarId: calendar.id,
    credentialId: credential.id,
    secondCalendarId: second.id,
  };
};

const readCalendar = async (calendarId: string) => {
  const [row] = await database
    .select({
      disabled: calendarsTable.disabled,
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

const readCredentialPassword = async (accountId: string): Promise<string | undefined> => {
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

const countRows = async (table: typeof calendarsTable | typeof calendarAccountsTable) => {
  const [row] = await database.select({ value: count() }).from(table);
  return row?.value ?? 0;
};

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
    values ('${USER_ID}', 'caldav-reconnect@example.com', 'CalDAV Reconnect')
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
  await client.unsafe("delete from calendars");
  await client.unsafe("delete from calendar_accounts");
  await client.unsafe("delete from caldav_credentials");
});

describe.skipIf(!administrativeUrl)("re-adding a CalDAV source with a new password", () => {
  it("reports a reconnect instead of a duplicate", async () => {
    const seeded = await seedFailedSource();

    const result = await createCalDAVSource(USER_ID, sourceData());

    expect(result.reconnected).toBe(true);
    expect(result.source.id).toBe(seeded.calendarId);
  });

  it("stores the new password and clears the reauthentication marker", async () => {
    const seeded = await seedFailedSource();

    await createCalDAVSource(USER_ID, sourceData());

    const [credential] = await database
      .select({ encryptedPassword: caldavCredentialsTable.encryptedPassword })
      .from(caldavCredentialsTable)
      .where(eq(caldavCredentialsTable.id, seeded.credentialId))
      .limit(1);
    expect(credential?.encryptedPassword).toBe("encrypted:fresh-app-password");
    expect(await readAccountFlag(seeded.accountId)).toBe(false);
  });

  it("clears the ingest backoff on every calendar of the account", async () => {
    const seeded = await seedFailedSource();

    await createCalDAVSource(USER_ID, sourceData());

    expect(await readCalendar(seeded.calendarId)).toMatchObject({
      ingestFailureCount: 0,
      ingestNextAttemptAt: null,
    });
    expect(await readCalendar(seeded.secondCalendarId)).toMatchObject({
      ingestFailureCount: 0,
      ingestNextAttemptAt: null,
    });
  });

  it("creates no extra rows when the user submits the same reconnect twice", async () => {
    await seedFailedSource();
    const calendarsBefore = await countRows(calendarsTable);
    const accountsBefore = await countRows(calendarAccountsTable);

    await createCalDAVSource(USER_ID, sourceData());
    await createCalDAVSource(USER_ID, sourceData());

    expect(await countRows(calendarsTable)).toBe(calendarsBefore);
    expect(await countRows(calendarAccountsTable)).toBe(accountsBefore);
  });

  it("leaves a deliberately paused calendar paused", async () => {
    const seeded = await seedFailedSource();
    await database
      .update(calendarsTable)
      .set({ disabled: true })
      .where(eq(calendarsTable.id, seeded.secondCalendarId));

    await createCalDAVSource(USER_ID, sourceData());

    expect(await readCalendarDisabled(seeded.secondCalendarId)).toBe(true);
  });

  it("adds a new calendar under the existing account without a second account", async () => {
    const seeded = await seedFailedSource();
    const accountsBefore = await countRows(calendarAccountsTable);

    const result = await createCalDAVSource(
      USER_ID,
      sourceData({ calendarUrl: "https://caldav.icloud.com/work", name: "Work" }),
    );

    expect(result.reconnected).toBe(false);
    expect(result.source.accountId).toBe(seeded.accountId);
    expect(await countRows(calendarAccountsTable)).toBe(accountsBefore);
  });

  it("rejects a re-add whose username no longer matches the stored account", async () => {
    await seedFailedSource();

    const failure = await createCalDAVSource(
      USER_ID,
      sourceData({ username: "person@me.com" }),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DuplicateCalDAVSourceError);
  });

  it("refuses to reconnect a calendar row owned by a different account", async () => {
    const seeded = await seedFailedSource();
    const [otherCredential] = await database
      .insert(caldavCredentialsTable)
      .values({
        encryptedPassword: "encrypted:other-app-password",
        serverUrl: SERVER_URL,
        username: "second@icloud.com",
      })
      .returning({ id: caldavCredentialsTable.id });
    const [otherAccount] = await database
      .insert(calendarAccountsTable)
      .values({
        authType: "caldav",
        caldavCredentialId: otherCredential?.id,
        provider: "apple",
        userId: USER_ID,
      })
      .returning({ id: calendarAccountsTable.id });

    const failure = await createCalDAVSource(
      USER_ID,
      sourceData({ username: "second@icloud.com" }),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DuplicateCalDAVSourceError);
    expect(await readCalendar(seeded.calendarId)).toMatchObject({
      ingestFailureCount: 6,
      ingestNextAttemptAt: REARMED_AT,
    });
    expect(await readAccountFlag(seeded.accountId)).toBe(true);
    expect(await countRows(calendarsTable)).toBe(2);
    expect(await readCredentialPassword(otherAccount?.id ?? "")).toBe("encrypted:other-app-password");
  });
});
