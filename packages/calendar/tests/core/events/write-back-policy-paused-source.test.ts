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
  "writeBackReach" text not null default 'own_events',
  "sourceCalendarId" uuid not null,
  "writeBackMode" text not null default 'off',
  "writeBackState" text not null default 'ok'
);
`;

const seed = async (disabled: boolean): Promise<void> => {
  await client.query(
    `insert into calendars ("id", "capabilities", "disabled") values ($1, $2, $3)`,
    [SOURCE_CALENDAR_ID, ["pull", "push"], disabled],
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

describe("the write-back policy of a paused source calendar", () => {
  it("offers no active mode while the source is paused", async () => {
    await seed(true);

    expect(await readPolicyMode()).toBe("off");
  });

  it("still offers the stored mode while the source is running", async () => {
    await seed(false);

    expect(await readPolicyMode()).toBe("edits_and_deletes");
  });
});
