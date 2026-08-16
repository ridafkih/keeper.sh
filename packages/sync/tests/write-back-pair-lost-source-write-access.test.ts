import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { createDatabaseWriteBackStore } from "../src/write-back";

const client = new PGlite();
const database = drizzle(client);

const USER_ID = "user-id";
const SOURCE_CALENDAR_ID = "11111111-1111-4111-8111-111111111111";
const DESTINATION_CALENDAR_ID = "22222222-2222-4222-8222-222222222222";

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
  "id" uuid primary key,
  "accountId" uuid,
  "calendarType" text not null default 'google',
  "capabilities" text[] not null default '{pull}',
  "disabled" boolean not null default false,
  "ingestLastSucceededAt" timestamptz not null default now()
);
create table source_destination_mappings (
  "id" uuid primary key default gen_random_uuid(),
  "destinationCalendarId" uuid not null,
  "sourceCalendarId" uuid not null,
  "writeBackMode" text not null default 'off',
  "writeBackState" text not null default 'ok'
);
`;

const store = createDatabaseWriteBackStore({
  database: database as unknown as BunSQLDatabase,
  encryptionKey: "encryption-key",
  oauthConfig: {},
  userId: USER_ID,
});

const seed = async (capabilities: string[]): Promise<void> => {
  await client.query(
    `insert into calendars ("id", "capabilities") values ($1, $2)`,
    [SOURCE_CALENDAR_ID, capabilities],
  );
  await client.query(
    `insert into calendars ("id", "capabilities") values ($1, $2)`,
    [DESTINATION_CALENDAR_ID, ["pull", "push"]],
  );
  await client.query(
    `insert into source_destination_mappings
       ("destinationCalendarId", "sourceCalendarId", "writeBackMode")
     values ($1, $2, 'edits_and_deletes')`,
    [DESTINATION_CALENDAR_ID, SOURCE_CALENDAR_ID],
  );
};

const readPair = (): Promise<{ writeBackMode: string } | null> =>
  store.withSourceLock(SOURCE_CALENDAR_ID, (locked) =>
    locked.readPairWriteBack({
      destinationCalendarId: DESTINATION_CALENDAR_ID,
      sourceCalendarId: SOURCE_CALENDAR_ID,
    }));

beforeEach(async () => {
  await client.exec(`drop table if exists source_destination_mappings cascade;`);
  await client.exec(`drop table if exists calendars cascade;`);
  await client.exec(`drop table if exists calendar_accounts cascade;`);
  await client.exec(`drop table if exists caldav_credentials cascade;`);
  await client.exec(DDL);
});

/*
 * The gate taken under the source lock, immediately before a real calendar is written. A
 * source regraded to read-only after two-way was switched on still carries its stored
 * mode, and reading that mode alone would send edits and deletions at a provider that can
 * only reject them.
 */
describe("the last write-back gate for a source that can no longer be written", () => {
  it("reads the pair as off once the source only carries read access", async () => {
    await seed(["pull"]);

    const pair = await readPair();

    expect(pair?.writeBackMode).toBe("off");
  });

  it("still reads the stored mode while the source can be written", async () => {
    await seed(["pull", "push"]);

    const pair = await readPair();

    expect(pair?.writeBackMode).toBe("edits_and_deletes");
  });
});
