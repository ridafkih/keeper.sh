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
const DESTINATION_ID = "11111111-1111-4111-8111-111111111111";

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

const seedPair = async (paused: boolean): Promise<string> => {
  const account = await client.query<{ id: string }>(
    `insert into calendar_accounts ("email") values ($1) returning "id"`,
    ["person@example.com"],
  );
  const accountId = account.rows[0]?.id;
  const calendar = await client.query<{ id: string }>(
    `insert into calendars ("accountId", "calendarType", "capabilities", "disabled", "userId")
     values ($1, 'google', $2, $3, $4) returning "id"`,
    [accountId, ["pull", "push"], paused, USER_ID],
  );
  const sourceCalendarId = calendar.rows[0]?.id;
  if (!sourceCalendarId) {
    throw new Error("Failed to seed a calendar");
  }
  await client.query(
    `insert into source_destination_mappings
       ("sourceCalendarId", "destinationCalendarId", "writeBackMode")
     values ($1, $2, 'edits_and_deletes')`,
    [sourceCalendarId, DESTINATION_ID],
  );
  return sourceCalendarId;
};

beforeEach(async () => {
  await client.exec(`drop table if exists source_destination_mappings cascade;`);
  await client.exec(`drop table if exists calendars cascade;`);
  await client.exec(`drop table if exists calendar_accounts cascade;`);
  await client.exec(`drop table if exists caldav_credentials cascade;`);
  await client.exec(DDL);
});

/*
 * Pausing a calendar is the documented way to make Keeper.sh stop touching it, and the
 * screen already reports a paused pair as one-way. Accepting two-way on it stores a mode
 * the screen then denies, and the mode goes live the moment the calendar is resumed —
 * from a screen that last said one-way.
 */
describe("a paused source calendar", () => {
  it("is refused two-way sync, the same answer the screen is given", async () => {
    const sourceCalendarId = await seedPair(true);

    const reported = await getWriteBackModesForSource(USER_ID, sourceCalendarId);

    expect(reported[DESTINATION_ID]).toBe("off");
    expect(await sourceSupportsWriteBack(USER_ID, sourceCalendarId)).toBe(false);
  });

  it("still admits two-way sync once it is not paused", async () => {
    const sourceCalendarId = await seedPair(false);

    const reported = await getWriteBackModesForSource(USER_ID, sourceCalendarId);

    expect(reported[DESTINATION_ID]).toBe("edits_and_deletes");
    expect(await sourceSupportsWriteBack(USER_ID, sourceCalendarId)).toBe(true);
  });
});
