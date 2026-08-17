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
  "calendarType" text not null default 'google',
  "capabilities" text[] not null default '{pull}',
  "disabled" boolean not null default false,
  "userId" text not null
);
create table source_destination_mappings (
  "id" uuid primary key default gen_random_uuid(),
  "sourceCalendarId" uuid not null,
  "destinationCalendarId" uuid not null,
  "writeBackMode" text not null default 'off'
  ,"writeBackReach" text not null default 'own_events'
);
`;

const insertCalendar = async (capabilities: string[]): Promise<string> => {
  const result = await client.query<{ id: string }>(
    `insert into calendars ("calendarType", "capabilities", "userId")
     values ('google', $1, $2) returning "id"`,
    [capabilities, USER_ID],
  );
  const id = result.rows[0]?.id;
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
    `insert into source_destination_mappings
       ("sourceCalendarId", "destinationCalendarId", "writeBackMode")
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
 * Calendar rediscovery rewrites "capabilities" when a provider reports a calendar the
 * account may no longer change. Nothing rewrites the mode the pair is already carrying, so
 * the same screen is handed two contradictory answers about the same calendar: the mode
 * says two-way including deletions, and the writability says Keeper.sh may only read it.
 */
describe("a source calendar whose write access was revoked after two-way was enabled", () => {
  it("no longer reports an active two-way mode", async () => {
    const sourceCalendarId = await insertCalendar(["pull"]);
    const destinationCalendarId = await insertCalendar(["pull", "push"]);
    await insertMapping(sourceCalendarId, destinationCalendarId, "edits_and_deletes");

    expect(await sourceSupportsWriteBack(USER_ID, sourceCalendarId)).toBe(false);
    expect(await getWriteBackModesForSource(USER_ID, sourceCalendarId)).toEqual({
      [destinationCalendarId]: "off",
    });
  });

  it("still reports the mode a writable source is carrying", async () => {
    const sourceCalendarId = await insertCalendar(["pull", "push"]);
    const destinationCalendarId = await insertCalendar(["pull", "push"]);
    await insertMapping(sourceCalendarId, destinationCalendarId, "edits_and_deletes");

    expect(await sourceSupportsWriteBack(USER_ID, sourceCalendarId)).toBe(true);
    expect(await getWriteBackModesForSource(USER_ID, sourceCalendarId)).toEqual({
      [destinationCalendarId]: "edits_and_deletes",
    });
  });
});
