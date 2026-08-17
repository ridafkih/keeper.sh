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

const { createOAuthAccountIdWithDatabase, findOAuthAccountIdWithDatabase } = await import(
  "../../src/utils/oauth-sources"
);

type SourceClient = Parameters<typeof findOAuthAccountIdWithDatabase>[0];

const sourceClient = database as unknown as SourceClient;

const DDL = `
create table oauth_credentials (
  "id" uuid primary key default gen_random_uuid(),
  "accessToken" text not null,
  "createdAt" timestamptz not null default now(),
  "email" text,
  "expiresAt" timestamptz not null,
  "needsReauthentication" boolean not null default false,
  "provider" text not null,
  "refreshToken" text not null,
  "updatedAt" timestamptz not null default now(),
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
  "calendarsRefreshAttemptedAt" timestamptz,
  "calendarsRefreshedAt" timestamptz,
  "createdAt" timestamptz not null default now(),
  "displayName" text,
  "email" text,
  "needsReauthentication" boolean not null default false,
  "oauthCredentialId" uuid,
  "provider" text not null,
  "reauthenticationSource" text,
  "updatedAt" timestamptz not null default now(),
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
  "createdAt" timestamptz not null default now(),
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
  "ingestLastFailureAt" timestamptz,
  "ingestNextAttemptAt" timestamptz,
  "ingestWindowEnd" timestamptz,
  "ingestWindowRecordedAt" timestamptz,
  "ingestLastSucceededAt" timestamptz,
  "ingestWindowStart" timestamptz,
  "lastFailureAt" timestamptz,
  "name" text not null,
  "nextAttemptAt" timestamptz,
  "originalName" text,
  "syncFutureRange" text not null default '2_years',
  "syncHistoricRange" text not null default '1_month',
  "syncToken" text,
  "treatFullDayTimedEventsAsAllDay" boolean not null default false,
  "unavailableSince" timestamptz,
  "updatedAt" timestamptz not null default now(),
  "url" text,
  "userId" text not null
);
create table source_destination_mappings (
  "id" uuid primary key default gen_random_uuid(),
  "createdAt" timestamptz not null default now(),
  "destinationCalendarId" uuid not null,
  "sourceCalendarId" uuid not null
  ,"writeBackReach" text not null default 'own_events'
);
create table sync_status (
  "id" uuid primary key default gen_random_uuid(),
  "calendarId" uuid not null,
  "lastSyncedAt" timestamptz,
  "localEventCount" integer not null default 0,
  "remoteEventCount" integer not null default 0,
  "updatedAt" timestamptz not null default now()
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

const seedSourceAccount = async (options: {
  accountId: string | null;
  email: string | null;
}): Promise<{ accountRowId: string; credentialId: string }> => {
  const credential = await client.query<{ id: string }>(
    `insert into oauth_credentials
       ("accessToken", "email", "expiresAt", "provider", "refreshToken", "userId")
     values ('source-access', $1, $2, 'google', 'source-refresh', $3)
     returning "id"`,
    [options.email, EXPIRES_AT, USER_ID],
  );
  const credentialId = credential.rows[0]?.id;
  if (!credentialId) {
    throw new Error("Failed to seed an OAuth credential");
  }

  const account = await client.query<{ id: string }>(
    `insert into calendar_accounts
       ("accountId", "authType", "email", "oauthCredentialId", "provider", "userId")
     values ($1, 'oauth', $2, $3, 'google', $4)
     returning "id"`,
    [options.accountId, options.email, credentialId, USER_ID],
  );
  const accountRowId = account.rows[0]?.id;
  if (!accountRowId) {
    throw new Error("Failed to seed a calendar account");
  }

  return { accountRowId, credentialId };
};

describe("linking a provider account that the user already holds", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets a second user link the same provider account as a source", async () => {
    await seedSourceAccount({
      accountId: PROVIDER_ACCOUNT_ID,
      email: "person@example.com",
    });

    await expect(createOAuthAccountIdWithDatabase(sourceClient, {
      email: "person@example.com",
      oauthCredentialId: "00000000-0000-4000-8000-0000000000ff",
      provider: "google",
      providerAccountId: PROVIDER_ACCOUNT_ID,
      userId: "user-2",
    })).resolves.toEqual(expect.any(String));
  });

  it("reuses the existing row when the source flow arrives on a different credential", async () => {
    const { accountRowId } = await seedSourceAccount({
      accountId: PROVIDER_ACCOUNT_ID,
      email: "person@example.com",
    });

    const found = await findOAuthAccountIdWithDatabase(sourceClient, {
      oauthCredentialId: "00000000-0000-4000-8000-0000000000ff",
      provider: "google",
      providerAccountId: PROVIDER_ACCOUNT_ID,
      userId: USER_ID,
    });

    expect(found).toBe(accountRowId);
  });

  it("refuses to insert a second row for a provider account the user already holds", async () => {
    await seedSourceAccount({
      accountId: PROVIDER_ACCOUNT_ID,
      email: "person@example.com",
    });

    await expect(createOAuthAccountIdWithDatabase(sourceClient, {
      email: "person@example.com",
      oauthCredentialId: "00000000-0000-4000-8000-0000000000ff",
      provider: "google",
      providerAccountId: PROVIDER_ACCOUNT_ID,
      userId: USER_ID,
    })).rejects.toThrow();
  });
});
