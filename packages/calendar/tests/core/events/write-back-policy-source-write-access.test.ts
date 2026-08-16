import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { getWriteBackPoliciesForDestination } from "../../../src/core/events/events";

const client = new PGlite();
const database = drizzle(client);

const SOURCE_CALENDAR_ID = "11111111-1111-4111-8111-111111111111";
const DESTINATION_CALENDAR_ID = "22222222-2222-4222-8222-222222222222";

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
  "ingestLastSucceededAt" timestamptz not null default now(),
  "excludeEventDescription" boolean not null default false,
  "excludeEventLocation" boolean not null default false,
  "excludeEventName" boolean not null default false,
  "userId" text not null default 'user-1'
);
create table source_destination_mappings (
  "id" uuid primary key default gen_random_uuid(),
  "deleteConfirmationApprovedAt" timestamptz,
  "destinationCalendarId" uuid not null,
  "sourceCalendarId" uuid not null,
  "writeBackMode" text not null default 'off',
  "writeBackState" text not null default 'ok'
);
`;

const seed = async (capabilities: string[], calendarType = "google"): Promise<void> => {
  await client.query(
    `insert into calendars ("id", "calendarType", "capabilities") values ($1, $2, $3)`,
    [SOURCE_CALENDAR_ID, calendarType, capabilities],
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

const readPolicyMode = async (): Promise<string | undefined> => {
  const policies = await getWriteBackPoliciesForDestination(
    database as unknown as BunSQLDatabase,
    DESTINATION_CALENDAR_ID,
  );
  return policies.get(SOURCE_CALENDAR_ID)?.writeBackMode;
};

beforeEach(async () => {
  await client.exec(`drop table if exists source_destination_mappings cascade;`);
  await client.exec(`drop table if exists calendars cascade;`);
  await client.exec(`drop table if exists calendar_accounts cascade;`);
  await client.exec(`drop table if exists caldav_credentials cascade;`);
  await client.exec(DDL);
});

/*
 * Calendar rediscovery rewrites a source's capabilities when the provider stops granting
 * write access. Nothing rewrites the mode the pair is carrying, so the write-back pass
 * would keep classifying edits and deletions against a calendar Keeper.sh may only read,
 * firing them at the provider until enough rejections quarantine the pair.
 */
describe("write-back policies for a source whose write access was revoked", () => {
  it("stops offering an active mode once the source can only be read", async () => {
    await seed(["pull"]);

    expect(await readPolicyMode()).toBe("off");
  });

  it("stops offering an active mode for a source whose type can never be written", async () => {
    await seed(["pull", "push"], "ical");

    expect(await readPolicyMode()).toBe("off");
  });

  it("still carries the mode of a source the account can write", async () => {
    await seed(["pull", "push"]);

    expect(await readPolicyMode()).toBe("edits_and_deletes");
  });
});
