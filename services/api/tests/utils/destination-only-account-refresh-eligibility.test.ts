import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";

const client = new PGlite();
const database = drizzle(client);

vi.mock("@/context", () => ({ database }));

vi.mock("../../src/utils/safe-fetch-options", () => ({ safeFetchOptions: {} }));

const { loadRefreshableAccountsForUser } = await import(
  "../../src/utils/account-calendar-discovery"
);

const DDL = `
create table caldav_credentials (
  "id" uuid primary key,
  "serverUrl" text not null
);
create table calendar_accounts (
  "id" uuid primary key,
  "authType" text not null,
  "caldavCredentialId" uuid,
  "needsReauthentication" boolean not null default false,
  "provider" text not null,
  "userId" text not null
);
create table calendars (
  "id" uuid primary key,
  "color" text,
  "accountId" uuid not null,
  "calendarType" text not null,
  "calendarUrl" text,
  "externalCalendarId" text,
  "name" text not null,
  "originalName" text,
  "userId" text not null
);
`;

const CALDAV_DESTINATION_ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OAUTH_SOURCE_ACCOUNT = "22222222-2222-4222-8222-222222222222";
const OAUTH_DESTINATION_ACCOUNT = "33333333-3333-4333-8333-333333333333";

const SEED = `
insert into caldav_credentials ("id", "serverUrl")
values ('44444444-4444-4444-8444-444444444444', 'https://caldav.example.com');

insert into calendar_accounts ("id", "authType", "caldavCredentialId", "provider", "userId")
values
  ('${CALDAV_DESTINATION_ACCOUNT}', 'caldav', '44444444-4444-4444-8444-444444444444', 'caldav', 'user-1'),
  ('${OAUTH_SOURCE_ACCOUNT}', 'oauth', null, 'google', 'user-1'),
  ('${OAUTH_DESTINATION_ACCOUNT}', 'oauth', null, 'google', 'user-1');

insert into calendars ("id", "accountId", "calendarType", "calendarUrl", "externalCalendarId", "name", "originalName", "userId")
values
  (
    '55555555-5555-4555-8555-555555555555',
    '${CALDAV_DESTINATION_ACCOUNT}',
    'destination',
    'https://caldav.example.com/user/calendars/keeper/',
    null,
    'Keeper.sh',
    null,
    'user-1'
  ),
  (
    '66666666-6666-4666-8666-666666666666',
    '${OAUTH_SOURCE_ACCOUNT}',
    'source',
    null,
    'primary@example.com',
    'Work',
    'Work',
    'user-1'
  ),
  (
    '77777777-7777-4777-8777-777777777777',
    '${OAUTH_DESTINATION_ACCOUNT}',
    'destination',
    null,
    'keeper@group.calendar.google.com',
    'Keeper.sh',
    null,
    'user-1'
  );
`;

describe("selecting the accounts a user-wide calendar refresh may enumerate", () => {
  beforeAll(async () => {
    await client.exec(DDL);
    await client.exec(SEED);
  });

  it("refreshes only accounts that already have an imported calendar", async () => {
    const accounts = await loadRefreshableAccountsForUser("user-1");

    expect(accounts.map((account) => account.id)).toEqual([OAUTH_SOURCE_ACCOUNT]);
  });

  it("never refreshes a CalDAV account connected purely as a destination", async () => {
    const accounts = await loadRefreshableAccountsForUser("user-1");

    expect(accounts.map((account) => account.id)).not.toContain(
      CALDAV_DESTINATION_ACCOUNT,
    );
  });

  it("never refreshes an OAuth account connected purely as a destination", async () => {
    const accounts = await loadRefreshableAccountsForUser("user-1");

    expect(accounts.map((account) => account.id)).not.toContain(
      OAUTH_DESTINATION_ACCOUNT,
    );
  });
});
