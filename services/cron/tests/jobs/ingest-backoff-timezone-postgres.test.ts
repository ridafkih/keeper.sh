import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { eq } from "drizzle-orm";
import {
  calendarAccountsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const scratchName = `keeper_ingest_timezone_${process.pid}`;
const USER_ID = "ingest-timezone-user";
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

interface AttemptReadback {
  compareAndSwappedRows: number;
  nextAttemptAt: string | null;
  timeZone: string | null;
}

const seedArmedCalendar = async (): Promise<string> => {
  const [account] = await database
    .insert(calendarAccountsTable)
    .values({ authType: "none", provider: "ics", userId: USER_ID })
    .returning({ id: calendarAccountsTable.id });
  const [calendar] = await database
    .insert(calendarsTable)
    .values({
      accountId: account?.id ?? "",
      calendarType: "ical",
      ingestFailureCount: 3,
      ingestLastFailureAt: PARKED_UNTIL,
      ingestNextAttemptAt: PARKED_UNTIL,
      name: "Parked",
      url: "https://example.com/feed.ics",
      userId: USER_ID,
    })
    .returning({ id: calendarsTable.id });

  if (!calendar) {
    throw new Error("Failed to seed the parked calendar");
  }
  return calendar.id;
};

const readAttemptInTimeZone = async (
  calendarId: string,
  timeZone: string,
): Promise<AttemptReadback> => {
  const script = `${import.meta.dirname}/../fixtures/read-ingest-attempt.ts`;
  const result = await Bun.$`bun ${script}`
    .env({
      ...process.env,
      CALENDAR_ID: calendarId,
      DATABASE_URL: scratchUrl(),
      TZ: timeZone,
    })
    .quiet()
    .nothrow();

  if (result.exitCode !== 0) {
    throw new Error(`Readback failed: ${result.stderr.toString()}`);
  }

  return JSON.parse(result.stdout.toString()) as AttemptReadback;
};

const readStoredFailureCount = async (calendarId: string): Promise<number | undefined> => {
  const [row] = await database
    .select({ ingestFailureCount: calendarsTable.ingestFailureCount })
    .from(calendarsTable)
    .where(eq(calendarsTable.id, calendarId))
    .limit(1);
  return row?.ingestFailureCount;
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
    values ('${USER_ID}', 'timezone@example.com', 'Timezone')
  `);
});

afterAll(async () => {
  if (!administrativeUrl) {
    return;
  }
  await client.end();
  await withAdministrativeClient([`drop database if exists "${scratchName}"`]);
});

describe.skipIf(!administrativeUrl)("an ingest attempt clock read by a worker", () => {
  it("reads back the instant it was armed with when the worker runs in UTC", async () => {
    const calendarId = await seedArmedCalendar();

    const readback = await readAttemptInTimeZone(calendarId, "UTC");

    expect(readback.nextAttemptAt).toBe(PARKED_UNTIL.toISOString());
    expect(readback.compareAndSwappedRows).toBe(1);
  });

  it("reads back the same instant on a worker west of UTC", async () => {
    const calendarId = await seedArmedCalendar();

    const readback = await readAttemptInTimeZone(calendarId, "America/New_York");

    expect(readback.nextAttemptAt).toBe(PARKED_UNTIL.toISOString());
  });

  it("still matches its own observed attempt when the worker is not in UTC", async () => {
    const calendarId = await seedArmedCalendar();

    const readback = await readAttemptInTimeZone(calendarId, "America/New_York");

    expect(readback.compareAndSwappedRows).toBe(1);
    expect(await readStoredFailureCount(calendarId)).toBe(4);
  });

  it("reads back the same instant on a worker east of UTC", async () => {
    const calendarId = await seedArmedCalendar();

    const readback = await readAttemptInTimeZone(calendarId, "Pacific/Auckland");

    expect(readback.nextAttemptAt).toBe(PARKED_UNTIL.toISOString());
    expect(readback.compareAndSwappedRows).toBe(1);
  });
});
