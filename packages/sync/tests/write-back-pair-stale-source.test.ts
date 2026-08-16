import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { TWO_WAY_SOURCE_INGEST_MAX_AGE_MS } from "@keeper.sh/constants";
import { createDatabaseWriteBackStore } from "../src/write-back";

const client = new PGlite();
const database = drizzle(client);

const USER_ID = "user-id";
const SOURCE_CALENDAR_ID = "11111111-1111-4111-8111-111111111111";
const DESTINATION_CALENDAR_ID = "22222222-2222-4222-8222-222222222222";
const MINUTE_MS = 60_000;
const STALE_MS = TWO_WAY_SOURCE_INGEST_MAX_AGE_MS + MINUTE_MS;
const FRESH_MS = MINUTE_MS;

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
  "ingestLastSucceededAt" timestamptz
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

const seed = async (ingestLastSucceededAt: Date | null): Promise<void> => {
  await client.query(
    `insert into calendars ("id", "capabilities", "ingestLastSucceededAt")
     values ($1, $2, $3)`,
    [SOURCE_CALENDAR_ID, ["pull", "push"], ingestLastSucceededAt],
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
 * An ingest that keeps failing backs off for hours at a time while the destination pass
 * carries on to its own schedule. Everything that stands between a destination-side edit
 * and the user's real event — the drift comparison, the expected-source check, the field
 * coverage a deletion is authorised by — is read from the copy that ingest stored, so once
 * it stops being refreshed they all agree with themselves and a rename the user made on
 * the original in the meantime is overwritten without any of them dissenting.
 */
describe("the last write-back gate for a source nobody has read lately", () => {
  it("reads the pair as off once the stored copy has aged out", async () => {
    await seed(new Date(Date.now() - STALE_MS));

    const pair = await readPair();

    expect(pair?.writeBackMode).toBe("off");
  });

  it("reads the pair as off for a source that never recorded a read", async () => {
    await seed(null);

    const pair = await readPair();

    expect(pair?.writeBackMode).toBe("off");
  });

  it("still reads the stored mode while the source is being read", async () => {
    await seed(new Date(Date.now() - FRESH_MS));

    const pair = await readPair();

    expect(pair?.writeBackMode).toBe("edits_and_deletes");
  });
});
