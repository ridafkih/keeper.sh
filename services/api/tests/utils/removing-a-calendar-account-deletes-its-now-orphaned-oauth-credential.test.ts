import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = new PGlite();
const database = drizzle(client);

vi.mock("@/context", () => ({
  database,
  encryptionKey: "encryption-key",
}));

vi.mock("@/utils/logging", () => ({
  widelog: {
    error: () => null,
    errorFields: () => null,
    set: () => null,
  },
}));

vi.mock("@/utils/source-destination-mappings", () => ({
  requestUserSync: () => Promise.resolve(),
  scheduleMappingReplacementSync: () => null,
  withMappingMutationLocks: async <TResult,>(
    _userId: string,
    resolveDestinationCalendarIds: () => Promise<string[]>,
    callback: () => Promise<TResult>,
  ) => ({
    destinationCalendarIds: await resolveDestinationCalendarIds(),
    result: await callback(),
  }),
}));

const { createDeleteCalendarAccountDependencies } = await import(
  "../../src/utils/delete-calendar-account-dependencies"
);

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
  "oauthCredentialId" uuid references oauth_credentials("id") on delete cascade,
  "provider" text not null,
  "reauthenticationSource" text,
  "updatedAt" timestamptz not null default now(),
  "userId" text not null
);
create unique index "calendar_accounts_provider_account_idx"
  on "calendar_accounts" ("userId", "provider", "accountId");
create table calendars (
  "id" uuid primary key default gen_random_uuid(),
  "accountId" uuid not null references calendar_accounts("id") on delete cascade,
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
);
create table user_sync_requests (
  "userId" text primary key,
  "requestId" uuid not null,
  "requestedAt" timestamptz not null default now()
);
`;

const USER_ID = "user-1";
const EXPIRES_AT = new Date("2027-01-01T00:00:00.000Z");

const resetDatabase = async (): Promise<void> => {
  await client.exec(`
    drop table if exists user_sync_requests, source_destination_mappings, calendars,
      calendar_accounts, oauth_credentials cascade;
  `);
  await client.exec(DDL);
};

const seedCredential = async (): Promise<string> => {
  const credential = await client.query<{ id: string }>(
    `insert into oauth_credentials
       ("accessToken", "email", "expiresAt", "provider", "refreshToken", "userId")
     values ('access', 'person@example.com', $1, 'google', 'refresh', $2)
     returning "id"`,
    [EXPIRES_AT, USER_ID],
  );
  const credentialId = credential.rows[0]?.id;
  if (!credentialId) {
    throw new Error("Failed to seed an OAuth credential");
  }
  return credentialId;
};

const seedAccount = async (
  credentialId: string,
  providerAccountId: string,
): Promise<string> => {
  const account = await client.query<{ id: string }>(
    `insert into calendar_accounts
       ("accountId", "authType", "email", "oauthCredentialId", "provider", "userId")
     values ($1, 'oauth', 'person@example.com', $2, 'google', $3)
     returning "id"`,
    [providerAccountId, credentialId, USER_ID],
  );
  const accountRowId = account.rows[0]?.id;
  if (!accountRowId) {
    throw new Error("Failed to seed a calendar account");
  }
  return accountRowId;
};

const seedCalendar = async (accountRowId: string): Promise<void> => {
  await client.query(
    `insert into calendars ("accountId", "calendarType", "name", "userId")
     values ($1, 'google', 'Primary', $2)`,
    [accountRowId, USER_ID],
  );
};

const countCredentials = async (credentialId: string): Promise<number> => {
  const rows = await client.query<{ count: string }>(
    `select count(*)::text as count from oauth_credentials where "id" = $1`,
    [credentialId],
  );
  return Number(rows.rows[0]?.count ?? "0");
};

describe("removing a calendar account", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("deletes the oauth credential the removed account was the last holder of", async () => {
    const credentialId = await seedCredential();
    const accountRowId = await seedAccount(credentialId, "provider-account-1");
    await seedCalendar(accountRowId);

    const { deleteAccountRow } = createDeleteCalendarAccountDependencies();

    await expect(
      deleteAccountRow({ accountId: accountRowId, userId: USER_ID }),
    ).resolves.toBe(true);

    await expect(countCredentials(credentialId)).resolves.toBe(0);
  });

  it("leaves a credential another calendar account of the same user still references", async () => {
    const credentialId = await seedCredential();
    const removedAccountRowId = await seedAccount(credentialId, "provider-account-1");
    const survivingAccountRowId = await seedAccount(credentialId, "provider-account-2");
    await seedCalendar(removedAccountRowId);
    await seedCalendar(survivingAccountRowId);

    const { deleteAccountRow } = createDeleteCalendarAccountDependencies();

    await expect(
      deleteAccountRow({ accountId: removedAccountRowId, userId: USER_ID }),
    ).resolves.toBe(true);

    await expect(countCredentials(credentialId)).resolves.toBe(1);
    const surviving = await client.query<{ id: string }>(
      `select "id" from calendar_accounts where "id" = $1`,
      [survivingAccountRowId],
    );
    expect(surviving.rows).toHaveLength(1);
  });
});
