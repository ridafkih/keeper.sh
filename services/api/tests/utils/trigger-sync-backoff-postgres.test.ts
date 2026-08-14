import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { eq } from "drizzle-orm";
import {
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const scratchName = `keeper_trigger_backoff_${process.pid}`;
const USER_ID = "trigger-backoff-user";
const ARMED_AT = new Date("2026-08-13T09:00:00.000Z");
const DUE_AT = new Date("2026-08-13T15:00:00.000Z");

const context: { database: ReturnType<typeof drizzle> | null } = { database: null };

vi.mock("@/context", () => ({
  get database() {
    return context.database;
  },
}));

const enqueued: string[] = [];
vi.mock("@/utils/enqueue-push-sync", () => ({
  enqueuePushSync: (userId: string) => {
    enqueued.push(userId);
    return Promise.resolve();
  },
}));

const { triggerSync } = await import("@/utils/trigger-sync");

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

const database = (): ReturnType<typeof drizzle> => {
  if (!context.database) {
    throw new Error("Test database is not initialised");
  }
  return context.database;
};

const createAccount = async (label: string): Promise<string> => {
  const [credential] = await database()
    .insert(caldavCredentialsTable)
    .values({
      encryptedPassword: `encrypted-${label}`,
      serverUrl: "https://caldav.icloud.com",
      username: `${label}@example.com`,
    })
    .returning({ id: caldavCredentialsTable.id });
  const [account] = await database()
    .insert(calendarAccountsTable)
    .values({
      authType: "caldav",
      caldavCredentialId: credential?.id,
      provider: "apple",
      userId: USER_ID,
    })
    .returning({ id: calendarAccountsTable.id });
  if (!account) {
    throw new Error("Failed to seed account");
  }
  return account.id;
};

const createCalendar = async (
  accountId: string,
  overrides: Partial<typeof calendarsTable.$inferInsert> = {},
): Promise<string> => {
  const [calendar] = await database()
    .insert(calendarsTable)
    .values({
      accountId,
      calendarType: "caldav",
      capabilities: ["pull", "push"],
      name: "Parked",
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
  const [row] = await database()
    .select({
      disabled: calendarsTable.disabled,
      failureCount: calendarsTable.failureCount,
      ingestNextAttemptAt: calendarsTable.ingestNextAttemptAt,
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
  context.database = drizzle(client);

  await client.unsafe(`
    insert into "user" (id, email, name) values
      ('${USER_ID}', 'trigger-backoff@example.com', 'Trigger Backoff')
  `);
});

afterAll(async () => {
  if (!administrativeUrl) {
    return;
  }
  await client.end();
  await withAdministrativeClient([`drop database if exists "${scratchName}"`]);
});

describe.skipIf(!administrativeUrl)("Sync now against a parked calendar", () => {
  it("unparks a calendar whose only armed clock is the destination push clock", async () => {
    const accountId = await createAccount("push-only");
    const calendarId = await createCalendar(accountId, {
      failureCount: 6,
      lastFailureAt: ARMED_AT,
      nextAttemptAt: DUE_AT,
    });

    const result = await triggerSync(USER_ID, "pro");

    expect(result.sourcesRefreshed).toBeGreaterThanOrEqual(1);
    expect(await readCalendar(calendarId)).toMatchObject({
      failureCount: 0,
      nextAttemptAt: null,
    });
  });

  it("clears both clocks when the source and the destination are parked together", async () => {
    const accountId = await createAccount("both-clocks");
    const calendarId = await createCalendar(accountId, {
      failureCount: 4,
      ingestFailureCount: 4,
      ingestLastFailureAt: ARMED_AT,
      ingestNextAttemptAt: DUE_AT,
      lastFailureAt: ARMED_AT,
      nextAttemptAt: DUE_AT,
    });

    await triggerSync(USER_ID, "pro");

    expect(await readCalendar(calendarId)).toMatchObject({
      failureCount: 0,
      ingestNextAttemptAt: null,
      nextAttemptAt: null,
    });
  });

  it("leaves a calendar the user paused on purpose parked and paused", async () => {
    const accountId = await createAccount("paused");
    const calendarId = await createCalendar(accountId, {
      disabled: true,
      failureCount: 3,
      lastFailureAt: ARMED_AT,
      nextAttemptAt: DUE_AT,
    });

    await triggerSync(USER_ID, "pro");

    expect(await readCalendar(calendarId)).toMatchObject({
      disabled: true,
      failureCount: 3,
      nextAttemptAt: DUE_AT,
    });
  });

  it("enqueues the push regardless of how many calendars were unparked", async () => {
    enqueued.length = 0;

    await triggerSync(USER_ID, "free");

    expect(enqueued).toEqual([USER_ID]);
  });
});
