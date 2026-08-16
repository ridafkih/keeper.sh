import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = new PGlite();
const database = drizzle(client);

vi.mock("@/context", () => ({ database }));

vi.mock("@/utils/background-task", () => ({
  spawnBackgroundJob: () => null,
}));

vi.mock("@/utils/enqueue-push-sync", () => ({
  enqueueMappingReplacementSync: () => Promise.resolve(),
  enqueuePushSync: () => Promise.resolve(),
}));

vi.mock("@keeper.sh/sync", () => ({
  createMappingMutationLockId: () => "lock-id",
  createSyncLock: () => ({ acquire: () => Promise.resolve({ acquired: false }) }),
}));

const { getWriteBackModesForSource, sourceSupportsWriteBack } = await import(
  "../../src/utils/source-destination-mappings"
);

const USER_ID = "user-1";

const DDL = `
create table caldav_credentials (
  "id" uuid primary key default gen_random_uuid(),
  "username" text not null
);
create table calendar_accounts (
  "id" uuid primary key default gen_random_uuid(),
  "caldavCredentialId" uuid,
  "email" text
);
create table calendars (
  "id" uuid primary key default gen_random_uuid(),
  "accountId" uuid,
  "calendarType" text not null default 'caldav',
  "capabilities" text[] not null default '{pull,push}',
  "disabled" boolean not null default false,
  "userId" text not null
);
create table source_destination_mappings (
  "id" uuid primary key default gen_random_uuid(),
  "destinationCalendarId" uuid not null,
  "sourceCalendarId" uuid not null,
  "writeBackMode" text not null default 'off',
  "writeBackState" text not null default 'ok',
  "writeBackStateReason" text
);
`;

const insertAccount = async (username: string | null): Promise<string | undefined> => {
  if (username === null) {
    const account = await client.query<{ id: string }>(
      `insert into calendar_accounts ("email") values ($1) returning "id"`,
      ["me@gmail.com"],
    );
    return account.rows[0]?.id;
  }
  const credential = await client.query<{ id: string }>(
    `insert into caldav_credentials ("username") values ($1) returning "id"`,
    [username],
  );
  const account = await client.query<{ id: string }>(
    `insert into calendar_accounts ("caldavCredentialId") values ($1) returning "id"`,
    [credential.rows[0]?.id],
  );
  return account.rows[0]?.id;
};

const insertCalendar = async (
  calendarType: string,
  username: string | null,
): Promise<string> => {
  const accountId = await insertAccount(username);
  const calendar = await client.query<{ id: string }>(
    `insert into calendars ("accountId", "calendarType", "userId") values ($1, $2, $3) returning "id"`,
    [accountId, calendarType, USER_ID],
  );
  const id = calendar.rows[0]?.id;
  if (!id) {
    throw new Error("Failed to seed a calendar");
  }
  return id;
};

const insertMapping = async (
  sourceCalendarId: string,
  destinationCalendarId: string,
  writeBackMode: string,
): Promise<void> => {
  await client.query(
    `insert into source_destination_mappings ("sourceCalendarId", "destinationCalendarId", "writeBackMode")
     values ($1, $2, $3)`,
    [sourceCalendarId, destinationCalendarId, writeBackMode],
  );
};

beforeEach(async () => {
  await client.exec(`drop table if exists source_destination_mappings cascade;`);
  await client.exec(`drop table if exists calendars cascade;`);
  await client.exec(`drop table if exists calendar_accounts cascade;`);
  await client.exec(`drop table if exists caldav_credentials cascade;`);
  await client.exec(DDL);
});

/*
 * The accept gate weighs a CalDAV source against the address its login carries; the gate
 * that tells the screen what the pair is doing does not select that address at all, so an
 * iCloud or Fastmail account is admitted by one and reported off by the other.
 */
describe("a CalDAV source signed in with an email address", () => {
  it("is reported with the mode the user chose", async () => {
    const sourceCalendarId = await insertCalendar("caldav", "me@fastmail.com");
    const destinationCalendarId = await insertCalendar("caldav", "me@fastmail.com");
    await insertMapping(sourceCalendarId, destinationCalendarId, "edits_and_deletes");

    expect(await sourceSupportsWriteBack(USER_ID, sourceCalendarId)).toBe(true);
    expect(await getWriteBackModesForSource(USER_ID, sourceCalendarId)).toEqual({
      [destinationCalendarId]: "edits_and_deletes",
    });
  });

  it("still reports off for a Google source, which never needed the login", async () => {
    const sourceCalendarId = await insertCalendar("google", null);
    const destinationCalendarId = await insertCalendar("google", null);
    await insertMapping(sourceCalendarId, destinationCalendarId, "edits");

    expect(await getWriteBackModesForSource(USER_ID, sourceCalendarId)).toEqual({
      [destinationCalendarId]: "edits",
    });
  });
});
