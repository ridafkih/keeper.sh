import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { and, eq, isNull } from "drizzle-orm";
import {
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearAccountReauthentication } from "../../src/utils/source-reauthentication";
import { setCalendarPaused } from "../../src/utils/calendar-pause";
import type { KeeperDatabase } from "../../src/types";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const scratchName = `keeper_reconnect_state_${process.pid}`;
const USER_ID = "reconnect-user";
const OTHER_USER_ID = "reconnect-other-user";
const ARMED_AT = new Date("2026-08-12T15:00:00.000Z");

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

const createAccount = async (provider: string): Promise<string> => {
  const [credential] = await database
    .insert(caldavCredentialsTable)
    .values({
      encryptedPassword: `encrypted-${provider}`,
      serverUrl: "https://caldav.example.com",
      username: `${provider}@example.com`,
    })
    .returning({ id: caldavCredentialsTable.id });
  const [account] = await database
    .insert(calendarAccountsTable)
    .values({
      authType: "caldav",
      caldavCredentialId: credential?.id,
      needsReauthentication: true,
      provider,
      userId: USER_ID,
    })
    .returning({ id: calendarAccountsTable.id });
  if (!account) {
    throw new Error("Failed to seed calendar account");
  }
  return account.id;
};

const createCalendar = async (
  accountId: string,
  overrides: Partial<typeof calendarsTable.$inferInsert> = {},
): Promise<string> => {
  const [calendar] = await database
    .insert(calendarsTable)
    .values({
      accountId,
      calendarType: "caldav",
      failureCount: 4,
      ingestFailureCount: 7,
      ingestLastFailureAt: ARMED_AT,
      ingestNextAttemptAt: ARMED_AT,
      lastFailureAt: ARMED_AT,
      name: "Seeded",
      nextAttemptAt: ARMED_AT,
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
      disabled: calendarsTable.disabled,
      failureCount: calendarsTable.failureCount,
      ingestFailureCount: calendarsTable.ingestFailureCount,
      ingestLastFailureAt: calendarsTable.ingestLastFailureAt,
      ingestNextAttemptAt: calendarsTable.ingestNextAttemptAt,
      nextAttemptAt: calendarsTable.nextAttemptAt,
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
    insert into "user" (id, email, name) values
      ('${USER_ID}', 'reconnect@example.com', 'Reconnect'),
      ('${OTHER_USER_ID}', 'other@example.com', 'Other')
  `);
});

afterAll(async () => {
  if (!administrativeUrl) {
    return;
  }
  await client.end();
  await withAdministrativeClient([`drop database if exists "${scratchName}"`]);
});

describe.skipIf(!administrativeUrl)("clearing an account's reauthentication state", () => {
  it("clears the marker and every ingest backoff column on the account", async () => {
    const accountId = await createAccount("clear-basic");
    const calendarId = await createCalendar(accountId);

    await clearAccountReauthentication(database as unknown as KeeperDatabase, accountId);

    expect(await readAccountFlag(accountId)).toBe(false);
    expect(await readCalendar(calendarId)).toMatchObject({
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    });
  });

  it("leaves a calendar the user paused on purpose paused", async () => {
    const accountId = await createAccount("clear-paused");
    const calendarId = await createCalendar(accountId, { disabled: true });

    await clearAccountReauthentication(database as unknown as KeeperDatabase, accountId);

    expect(await readCalendarDisabled(calendarId)).toBe(true);
  });

  it("does not touch a calendar belonging to another account", async () => {
    const accountId = await createAccount("clear-scoped");
    const otherAccountId = await createAccount("clear-untouched");
    await createCalendar(accountId);
    const otherCalendarId = await createCalendar(otherAccountId);

    await clearAccountReauthentication(database as unknown as KeeperDatabase, accountId);

    expect(await readCalendar(otherCalendarId)).toMatchObject({
      ingestFailureCount: 7,
      ingestNextAttemptAt: ARMED_AT,
    });
    expect(await readAccountFlag(otherAccountId)).toBe(true);
  });

  it("converges when the same reconnect is replayed", async () => {
    const accountId = await createAccount("clear-replay");
    const calendarId = await createCalendar(accountId);

    await clearAccountReauthentication(database as unknown as KeeperDatabase, accountId);
    const afterFirst = await readCalendar(calendarId);
    await clearAccountReauthentication(database as unknown as KeeperDatabase, accountId);
    const afterSecond = await readCalendar(calendarId);

    expect(afterSecond).toEqual(afterFirst);
  });

  it("leaves the row in the state the cron's compare-and-set expects to match", async () => {
    const accountId = await createAccount("clear-cas");
    const calendarId = await createCalendar(accountId);

    await clearAccountReauthentication(database as unknown as KeeperDatabase, accountId);

    const observed = await readCalendar(calendarId);
    const armed = await database
      .update(calendarsTable)
      .set({ ingestFailureCount: 1, ingestNextAttemptAt: new Date() })
      .where(and(
        eq(calendarsTable.id, calendarId),
        eq(calendarsTable.ingestFailureCount, observed?.ingestFailureCount ?? -1),
        isNull(calendarsTable.ingestNextAttemptAt),
      ))
      .returning({ id: calendarsTable.id });

    expect(armed).toHaveLength(1);
  });
});

describe.skipIf(!administrativeUrl)("pausing and resuming a calendar", () => {
  it("clears both the ingest and the destination backoff on resume", async () => {
    const accountId = await createAccount("resume-clears");
    const calendarId = await createCalendar(accountId, { disabled: true });

    await setCalendarPaused(database as unknown as KeeperDatabase, USER_ID, calendarId, false);

    expect(await readCalendar(calendarId)).toMatchObject({
      disabled: false,
      failureCount: 0,
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
      nextAttemptAt: null,
    });
  });

  it("keeps the armed state when the calendar is paused", async () => {
    const accountId = await createAccount("pause-keeps");
    const calendarId = await createCalendar(accountId);

    await setCalendarPaused(database as unknown as KeeperDatabase, USER_ID, calendarId, true);

    expect(await readCalendar(calendarId)).toMatchObject({
      disabled: true,
      ingestFailureCount: 7,
      ingestNextAttemptAt: ARMED_AT,
    });
  });

  it("refuses to resume a calendar that belongs to another user", async () => {
    const accountId = await createAccount("resume-scoped");
    const calendarId = await createCalendar(accountId, { disabled: true });

    const result = await setCalendarPaused(
      database as unknown as KeeperDatabase,
      OTHER_USER_ID,
      calendarId,
      false,
    );

    expect(result).toBeNull();
    expect(await readCalendar(calendarId)).toMatchObject({
      disabled: true,
      ingestFailureCount: 7,
    });
  });

  it("does not silently clear the reauthentication marker on resume", async () => {
    const accountId = await createAccount("resume-marker");
    const calendarId = await createCalendar(accountId, { disabled: true });

    await setCalendarPaused(database as unknown as KeeperDatabase, USER_ID, calendarId, false);

    expect(await readAccountFlag(accountId)).toBe(true);
  });

  it("converges when the resume is replayed on an already running calendar", async () => {
    const accountId = await createAccount("resume-replay");
    const calendarId = await createCalendar(accountId, { disabled: true });

    await setCalendarPaused(database as unknown as KeeperDatabase, USER_ID, calendarId, false);
    const afterFirst = await readCalendar(calendarId);
    await setCalendarPaused(database as unknown as KeeperDatabase, USER_ID, calendarId, false);

    expect(await readCalendar(calendarId)).toEqual(afterFirst);
  });
});
