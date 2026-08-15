import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = new PGlite();
const database = drizzle(client);

vi.mock("@/context", () => ({
  database,
  encryptionKey: "encryption-key",
  oauthProviders: {
    getProvider: () => null,
    hasRequiredScopes: () => true,
    isOAuthProvider: () => true,
  },
}));

vi.mock("@/utils/logging", () => ({
  widelog: {
    error: () => null,
    errorFields: () => null,
    set: () => null,
  },
}));

const { saveCalendarDestinationWithDatabase } = await import("../../src/utils/destinations");
type DestinationClient = Parameters<typeof saveCalendarDestinationWithDatabase>[0];

const destinationClient = database as unknown as DestinationClient;

const DDL = `
create table oauth_credentials (
  "id" uuid primary key default gen_random_uuid(),
  "accessToken" text not null,
  "createdAt" timestamp not null default now(),
  "email" text,
  "expiresAt" timestamp not null,
  "needsReauthentication" boolean not null default false,
  "provider" text not null,
  "refreshToken" text not null,
  "updatedAt" timestamp not null default now(),
  "userId" text not null
);
create table caldav_credentials (
  "id" uuid primary key default gen_random_uuid(),
  "authMethod" text not null default 'basic',
  "encryptedPassword" text not null,
  "serverUrl" text not null,
  "username" text not null
);
create table calendar_accounts (
  "id" uuid primary key default gen_random_uuid(),
  "accountId" text,
  "authType" text not null,
  "caldavCredentialId" uuid,
  "calendarsRefreshAttemptedAt" timestamp,
  "calendarsRefreshedAt" timestamp,
  "createdAt" timestamp not null default now(),
  "displayName" text,
  "email" text,
  "needsReauthentication" boolean not null default false,
  "oauthCredentialId" uuid,
  "provider" text not null,
  "reauthenticationSource" text,
  "updatedAt" timestamp not null default now(),
  "userId" text not null
);
create unique index "calendar_accounts_provider_account_idx"
  on "calendar_accounts" ("userId", "provider", "accountId");
create table calendars (
  "id" uuid primary key default gen_random_uuid(),
  "accountId" uuid not null,
  "calendarType" text not null,
  "calendarUrl" text,
  "capabilities" text[] not null default array['pull'],
  "createdAt" timestamp not null default now(),
  "customEventName" text not null default '{{calendar_name}}',
  "disabled" boolean not null default false,
  "excludeAllDayEvents" boolean not null default false,
  "excludeEventDescription" boolean not null default true,
  "excludeEventLocation" boolean not null default true,
  "excludeEventName" boolean not null default true,
  "excludeFocusTime" boolean not null default false,
  "excludeOutOfOffice" boolean not null default false,
  "externalCalendarId" text,
  "failureCount" integer not null default 0,
  "includeInIcalFeed" boolean not null default false,
  "ingestFailureCount" integer not null default 0,
  "ingestFutureRange" text not null default '2_years',
  "ingestHistoricRange" text not null default '1_month',
  "ingestLastFailureAt" timestamp,
  "ingestNextAttemptAt" timestamp,
  "ingestWindowEnd" timestamp,
  "ingestWindowRecordedAt" timestamp,
  "ingestWindowStart" timestamp,
  "lastFailureAt" timestamp,
  "name" text not null,
  "nextAttemptAt" timestamp,
  "originalName" text,
  "syncFutureRange" text not null default '2_years',
  "syncHistoricRange" text not null default '1_month',
  "syncToken" text,
  "treatFullDayTimedEventsAsAllDay" boolean not null default false,
  "unavailableSince" timestamp,
  "updatedAt" timestamp not null default now(),
  "url" text,
  "userId" text not null
);
create table source_destination_mappings (
  "id" uuid primary key default gen_random_uuid(),
  "createdAt" timestamp not null default now(),
  "destinationCalendarId" uuid not null,
  "sourceCalendarId" uuid not null
);
create table sync_status (
  "id" uuid primary key default gen_random_uuid(),
  "calendarId" uuid not null,
  "lastSyncedAt" timestamp,
  "localEventCount" integer not null default 0,
  "remoteEventCount" integer not null default 0,
  "updatedAt" timestamp not null default now()
);
create unique index "sync_status_calendar_idx" on "sync_status" ("calendarId");
`;

const PROVIDER_ACCOUNT_ID = "116651453584579904080";
const USER_ID = "user-1";
const EXPIRES_AT = new Date("2027-01-01T00:00:00.000Z");

const resetDatabase = async (): Promise<void> => {
  await client.exec(`
    drop table if exists sync_status, source_destination_mappings, calendars,
      calendar_accounts, oauth_credentials, caldav_credentials cascade;
  `);
  await client.exec(DDL);
};

const countCalendars = async (accountRowId: string): Promise<number> => {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from calendars where "accountId" = $1`,
    [accountRowId],
  );
  return Number(result.rows[0]?.count ?? "0");
};

const countAccounts = async (): Promise<number> => {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from calendar_accounts`,
  );
  return Number(result.rows[0]?.count ?? "0");
};

describe("reconnecting a destination that has no mapping yet", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("does not create a second destination calendar", async () => {
    const connect = () => saveCalendarDestinationWithDatabase(
      destinationClient,
      USER_ID,
      "google",
      PROVIDER_ACCOUNT_ID,
      "person@example.com",
      "destination-access",
      "destination-refresh",
      EXPIRES_AT,
    );

    await connect();
    await connect();

    const accountRow = await client.query<{ id: string }>(
      `select "id" from calendar_accounts limit 1`,
    );
    const accountRowId = accountRow.rows[0]?.id;
    if (!accountRowId) {
      throw new Error("Expected a calendar account");
    }

    expect(await countAccounts()).toBe(1);
    expect(await countCalendars(accountRowId)).toBe(1);
  });
});
