import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { eq } from "drizzle-orm";
import {
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearAccountReauthentication,
  clearSourceReauthentication,
} from "../../src/utils/source-reauthentication";
import { setCalendarPaused } from "../../src/utils/calendar-pause";
import {
  RECONNECTED_CALENDAR_STATE,
  RECONNECTED_BACKOFF_STATE,
} from "../../src/utils/calendar-state";
import type { KeeperDatabase } from "../../src/types";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const scratchName = `keeper_push_backoff_${process.pid}`;
const USER_ID = "push-backoff-user";
const ARMED_AT = new Date("2026-08-13T09:00:00.000Z");
const DUE_AT = new Date("2026-08-13T15:00:00.000Z");

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

const createCalDAVAccount = async (label: string): Promise<string> => {
  const [credential] = await database
    .insert(caldavCredentialsTable)
    .values({
      encryptedPassword: `encrypted-${label}`,
      serverUrl: "https://caldav.icloud.com",
      username: `${label}@example.com`,
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
  if (!account) {
    throw new Error("Failed to seed CalDAV account");
  }
  return account.id;
};

const createOAuthAccount = async (
  label: string,
): Promise<{ accountId: string; credentialId: string }> => {
  const [credential] = await database
    .insert(oauthCredentialsTable)
    .values({
      accessToken: `access-${label}`,
      email: `${label}@example.com`,
      expiresAt: ARMED_AT,
      provider: "google",
      refreshToken: `refresh-${label}`,
      userId: USER_ID,
    })
    .returning({ id: oauthCredentialsTable.id });
  if (!credential) {
    throw new Error("Failed to seed OAuth credential");
  }
  const [account] = await database
    .insert(calendarAccountsTable)
    .values({
      authType: "oauth",
      needsReauthentication: true,
      oauthCredentialId: credential.id,
      provider: "google",
      userId: USER_ID,
    })
    .returning({ id: calendarAccountsTable.id });
  if (!account) {
    throw new Error("Failed to seed OAuth account");
  }
  return { accountId: account.id, credentialId: credential.id };
};

const createParkedCalendar = async (
  accountId: string,
  overrides: Partial<typeof calendarsTable.$inferInsert> = {},
): Promise<string> => {
  const [calendar] = await database
    .insert(calendarsTable)
    .values({
      accountId,
      calendarType: "caldav",
      capabilities: ["pull", "push"],
      failureCount: 6,
      ingestFailureCount: 6,
      ingestLastFailureAt: ARMED_AT,
      ingestNextAttemptAt: DUE_AT,
      lastFailureAt: ARMED_AT,
      name: "Parked",
      nextAttemptAt: DUE_AT,
      userId: USER_ID,
      ...overrides,
    })
    .returning({ id: calendarsTable.id });
  if (!calendar) {
    throw new Error("Failed to seed calendar");
  }
  return calendar.id;
};

const readCalendar = async (calendarId: string) => {
  const [row] = await database
    .select({
      capabilities: calendarsTable.capabilities,
      disabled: calendarsTable.disabled,
      failureCount: calendarsTable.failureCount,
      ingestFailureCount: calendarsTable.ingestFailureCount,
      ingestNextAttemptAt: calendarsTable.ingestNextAttemptAt,
      lastFailureAt: calendarsTable.lastFailureAt,
      nextAttemptAt: calendarsTable.nextAttemptAt,
    })
    .from(calendarsTable)
    .where(eq(calendarsTable.id, calendarId))
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
    insert into "user" (id, email, name) values
      ('${USER_ID}', 'push-backoff@example.com', 'Push Backoff')
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
  "rotating a CalDAV password through the source route while the destination is parked",
  () => {
    it("clears the marker and the ingest backoff", async () => {
      const accountId = await createCalDAVAccount("caldav-rotate");
      const calendarId = await createParkedCalendar(accountId);

      await clearAccountReauthentication(database as unknown as KeeperDatabase, accountId);

      expect(await readCalendar(calendarId)).toMatchObject({
        ingestFailureCount: 0,
        ingestNextAttemptAt: null,
      });
    });

    it("leaves the push side of the very same calendar parked behind its old clock", async () => {
      const accountId = await createCalDAVAccount("caldav-push");
      const calendarId = await createParkedCalendar(accountId);

      await clearAccountReauthentication(database as unknown as KeeperDatabase, accountId);

      expect(await readCalendar(calendarId)).toMatchObject({
        failureCount: 0,
        nextAttemptAt: null,
      });
    });

    it("keeps the destination parked no matter how many times the user re-submits", async () => {
      const accountId = await createCalDAVAccount("caldav-replay");
      const calendarId = await createParkedCalendar(accountId);

      await clearAccountReauthentication(database as unknown as KeeperDatabase, accountId);
      await clearAccountReauthentication(database as unknown as KeeperDatabase, accountId);
      await clearAccountReauthentication(database as unknown as KeeperDatabase, accountId);

      const resumed = await readCalendar(calendarId);
      expect(resumed?.nextAttemptAt).toBeNull();
    });

    it("is unparked by the resume path, proving the state is reachable from elsewhere", async () => {
      const accountId = await createCalDAVAccount("caldav-resume");
      const calendarId = await createParkedCalendar(accountId);

      await clearAccountReauthentication(database as unknown as KeeperDatabase, accountId);
      await setCalendarPaused(database as unknown as KeeperDatabase, USER_ID, calendarId, false);

      expect(await readCalendar(calendarId)).toMatchObject({
        failureCount: 0,
        nextAttemptAt: null,
      });
    });
  },
);

describe.skipIf(!administrativeUrl)(
  "reconnecting an OAuth account through the source callback while a push-eligible failure has parked its destination",
  () => {
    it("clears the ingest backoff on every calendar of the credential", async () => {
      const { accountId, credentialId } = await createOAuthAccount("oauth-ingest");
      const calendarId = await createParkedCalendar(accountId, { calendarType: "oauth" });

      await clearSourceReauthentication(database as unknown as KeeperDatabase, credentialId);

      expect(await readCalendar(calendarId)).toMatchObject({
        ingestFailureCount: 0,
        ingestNextAttemptAt: null,
      });
    });

    it("leaves the destination push backoff armed after the reconnect", async () => {
      const { accountId, credentialId } = await createOAuthAccount("oauth-push");
      const calendarId = await createParkedCalendar(accountId, { calendarType: "oauth" });

      await clearSourceReauthentication(database as unknown as KeeperDatabase, credentialId);

      expect(await readCalendar(calendarId)).toMatchObject({
        failureCount: 0,
        nextAttemptAt: null,
      });
    });

    it("writes nothing and does not throw for a credential nobody uses", async () => {
      const { accountId } = await createOAuthAccount("oauth-orphan");
      const calendarId = await createParkedCalendar(accountId, { calendarType: "oauth" });
      const [orphan] = await database
        .insert(oauthCredentialsTable)
        .values({
          accessToken: "access-orphan",
          email: "orphan@example.com",
          expiresAt: ARMED_AT,
          provider: "google",
          refreshToken: "refresh-orphan",
          userId: USER_ID,
        })
        .returning({ id: oauthCredentialsTable.id });

      await clearSourceReauthentication(
        database as unknown as KeeperDatabase,
        orphan?.id ?? "",
      );

      expect(await readCalendar(calendarId)).toMatchObject({
        ingestFailureCount: 6,
        nextAttemptAt: DUE_AT,
      });
    });
  },
);

describe("the state a source reconnect and a manual Sync now write", () => {
  it("reaches the destination backoff columns the resume path already clears", () => {
    expect(Object.keys(RECONNECTED_BACKOFF_STATE).toSorted())
      .toEqual(
        Object.keys(RECONNECTED_CALENDAR_STATE)
          .filter((key) => key !== "disabled")
          .toSorted(),
      );
  });
});
