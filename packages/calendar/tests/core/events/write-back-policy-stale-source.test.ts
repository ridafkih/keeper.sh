import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { TWO_WAY_SOURCE_INGEST_MAX_AGE_MS } from "@keeper.sh/constants";
import { getWriteBackPoliciesForDestination } from "../../../src/core/events/events";
import type { WriteBackPolicy } from "../../../src/core/sync/write-back-policy";

const client = new PGlite();
const database = drizzle(client);

const SOURCE_CALENDAR_ID = "11111111-1111-4111-8111-111111111111";
const DESTINATION_CALENDAR_ID = "22222222-2222-4222-8222-222222222222";
const MINUTE_MS = 60_000;
const STALE_MS = TWO_WAY_SOURCE_INGEST_MAX_AGE_MS + MINUTE_MS;
const FRESH_MS = MINUTE_MS;

const DDL = `
create table caldav_credentials (
  "id" uuid primary key,
  "username" text not null
);
create table calendar_accounts (
  "id" uuid primary key,
  "caldavCredentialId" uuid,
  "email" text
);
create table calendars (
  "id" uuid primary key,
  "accountId" uuid,
  "calendarType" text not null default 'google',
  "capabilities" text[] not null default '{pull}',
  "disabled" boolean not null default false,
  "excludeEventDescription" boolean not null default false,
  "excludeEventLocation" boolean not null default false,
  "excludeEventName" boolean not null default false,
  "ingestLastSucceededAt" timestamptz,
  "userId" text not null default 'user-1'
);
create table source_destination_mappings (
  "id" uuid primary key default gen_random_uuid(),
  "deleteConfirmationApprovedAt" timestamptz,
  "destinationCalendarId" uuid not null,
  "writeBackReach" text not null default 'own_events',
  "sourceCalendarId" uuid not null,
  "writeBackMode" text not null default 'off',
  "writeBackState" text not null default 'ok'
);
`;

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
       ("destinationCalendarId", "sourceCalendarId", "writeBackMode",
        "deleteConfirmationApprovedAt")
     values ($1, $2, 'edits_and_deletes', now())`,
    [DESTINATION_CALENDAR_ID, SOURCE_CALENDAR_ID],
  );
};

const readPolicy = async (): Promise<WriteBackPolicy | undefined> => {
  const policies = await getWriteBackPoliciesForDestination(
    database as unknown as BunSQLDatabase,
    DESTINATION_CALENDAR_ID,
  );
  return policies.get(SOURCE_CALENDAR_ID);
};

beforeEach(async () => {
  await client.exec(`drop table if exists source_destination_mappings cascade;`);
  await client.exec(`drop table if exists calendars cascade;`);
  await client.exec(`drop table if exists calendar_accounts cascade;`);
  await client.exec(`drop table if exists caldav_credentials cascade;`);
  await client.exec(DDL);
});

/*
 * The classifier judges a copy on the destination against the copy of the source its last
 * ingest stored, and writes the difference to the user's real event. An ingest in backoff
 * leaves that stored copy frozen for hours while the destination pass keeps running, so
 * the difference it measures is against a calendar nobody has looked at — and the guards
 * meant to refuse when the original moved read the same frozen row.
 *
 * The pair pauses rather than reverting to one-way: reverting hands every mapping back to
 * the repair path, which would rebuild the copies from that same frozen snapshot and
 * discard whatever the user changed on them.
 */
describe("the write-back policy of a source nobody has read lately", () => {
  it("pauses the pair once the stored copy has aged out", async () => {
    await seed(new Date(Date.now() - STALE_MS));

    expect(await readPolicy()).toMatchObject({
      deleteApproved: false,
      paused: true,
      writeBackMode: "edits_and_deletes",
    });
  });

  it("pauses a pair whose source never recorded a read", async () => {
    await seed(null);

    expect(await readPolicy()).toMatchObject({ paused: true });
  });

  it("leaves the pair active while the source is being read", async () => {
    await seed(new Date(Date.now() - FRESH_MS));

    expect(await readPolicy()).toMatchObject({
      deleteApproved: true,
      paused: false,
      writeBackMode: "edits_and_deletes",
    });
  });
});
