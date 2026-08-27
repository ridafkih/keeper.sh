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
  premiumService: {
    canAddAccount: () => Promise.resolve(true),
    getAccountLimit: () => 10,
    getUserPlan: () => Promise.resolve("pro"),
  },
}));

vi.mock("@/utils/logging", () => ({
  widelog: {
    error: () => null,
    errorFields: () => null,
    set: () => null,
  },
}));

vi.mock("@keeper.sh/calendar/google", () => ({
  listUserCalendars: () => Promise.resolve([]),
}));

vi.mock("@keeper.sh/calendar/outlook", () => ({
  listUserCalendars: () => Promise.resolve([]),
}));

const { importOAuthAccountCalendars } = await import("../../src/utils/oauth-sources");

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
`;

const USER_ID = "user-1";
const EXPIRES_AT = new Date("2027-01-01T00:00:00.000Z");

const seedAccount = async (options: {
  accountIdIsItsOwnRowId: boolean;
  accountId?: string;
  email: string;
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
       ("authType", "email", "oauthCredentialId", "provider", "userId")
     values ('oauth', $1, $2, 'google', $3)
     returning "id"`,
    [options.email, credentialId, USER_ID],
  );
  const accountRowId = account.rows[0]?.id;
  if (!accountRowId) {
    throw new Error("Failed to seed a calendar account");
  }

  await client.query(
    `update calendar_accounts set "accountId" = $1 where "id" = $2`,
    [options.accountIdIsItsOwnRowId ? accountRowId : options.accountId, accountRowId],
  );

  return { accountRowId, credentialId };
};

const readAccountId = async (accountRowId: string): Promise<string | null> => {
  const result = await client.query<{ accountId: string | null }>(
    `select "accountId" from calendar_accounts where "id" = $1`,
    [accountRowId],
  );
  const [row] = result.rows;
  if (!row) {
    throw new Error("Seeded calendar account row disappeared");
  }
  return row.accountId;
};

describe("reconnecting an account whose accountId was fabricated from its own row id", () => {
  beforeEach(async () => {
    await client.exec(`drop table if exists calendars, calendar_accounts, oauth_credentials cascade;`);
    await client.exec(DDL);
  });

  it("adopts the real provider sub over a fabricated id, but leaves a genuine different sub alone", async () => {
    const legacy = await seedAccount({
      accountIdIsItsOwnRowId: true,
      email: "legacy@example.com",
    });

    await importOAuthAccountCalendars({
      accessToken: "access-token",
      email: "legacy@example.com",
      oauthCredentialId: legacy.credentialId,
      provider: "google",
      providerAccountId: "google-sub-real",
      userId: USER_ID,
    });

    expect(await readAccountId(legacy.accountRowId)).toBe("google-sub-real");

    const genuine = await seedAccount({
      accountId: "google-sub-other",
      accountIdIsItsOwnRowId: false,
      email: "other@example.com",
    });

    await importOAuthAccountCalendars({
      accessToken: "access-token",
      email: "other@example.com",
      oauthCredentialId: genuine.credentialId,
      provider: "google",
      providerAccountId: "google-sub-real",
      userId: USER_ID,
    });

    expect(await readAccountId(genuine.accountRowId)).toBe("google-sub-other");
  });
});
