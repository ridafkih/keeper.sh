import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTeardownResidueStore } from "@keeper.sh/calendar";

const client = new PGlite();
const database = drizzle(client);

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const DELETED_USER = "user-bob";
const GOOGLE_ACCOUNT_EMAIL = "bob@gmail.com";
const GOOGLE_SUB = "google-sub-123";
const NOW = new Date("2026-08-25T06:15:33.956Z");
const CREDENTIAL_EXPIRES_AT = new Date("2026-08-25T05:41:00.000Z");

vi.mock("@/context", () => ({
  database,
  encryptionKey: ENCRYPTION_KEY,
}));

vi.mock("@/utils/logging", () => ({
  widelog: {
    error: () => null,
    errorFields: () => null,
    set: () => null,
    setFields: () => null,
  },
}));

class AbandonedPushChannelError extends Error {}

vi.mock("@/utils/push-notifications/deregister-account-channels", () => ({
  AbandonedPushChannelError,
  deregisterUserPushChannels: () => Promise.resolve(0),
  listUserTeardownPushChannels: () => Promise.resolve([]),
}));

const DDL = `
create table "user" (
  "id" text primary key,
  "createdAt" timestamptz not null default now(),
  "email" text not null,
  "name" text not null default '',
  "updatedAt" timestamptz not null default now()
);
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
  "userId" text not null references "user"("id") on delete cascade
);
create table calendar_accounts (
  "id" uuid primary key default gen_random_uuid(),
  "accountId" text,
  "authType" text not null,
  "createdAt" timestamptz not null default now(),
  "email" text,
  "needsReauthentication" boolean not null default false,
  "oauthCredentialId" uuid references oauth_credentials("id") on delete cascade,
  "provider" text not null,
  "updatedAt" timestamptz not null default now(),
  "userId" text not null references "user"("id") on delete cascade
);
create unique index "calendar_accounts_provider_account_idx"
  on "calendar_accounts" ("userId", "provider", "accountId");
create table calendars (
  "id" uuid primary key default gen_random_uuid(),
  "name" text not null default 'calendar',
  "userId" text not null
);
create table deletion_residue (
  "accountEmail" text,
  "attempts" integer default 0 not null,
  "createdAt" timestamptz default now() not null,
  "credentialExpiresAt" timestamptz,
  "encryptedAccessToken" text,
  "encryptedRefreshToken" text,
  "expiresAt" timestamptz not null,
  "externalId" text,
  "id" uuid primary key default gen_random_uuid() not null,
  "kind" text not null,
  "lastAttemptAt" timestamptz,
  "nextAttemptAt" timestamptz,
  "provider" text,
  "providerAccountId" text,
  "providerChannelId" text,
  "providerResourceId" text,
  "userId" text not null
);
create index "deletion_residue_due_idx" on "deletion_residue" ("nextAttemptAt");
create index "deletion_residue_user_idx" on "deletion_residue" ("userId");
`;

const resetDatabase = async (): Promise<void> => {
  await client.exec(`
    drop table if exists deletion_residue, calendars, calendar_accounts, oauth_credentials, "user" cascade;
  `);
  await client.exec(DDL);
};

const seedGoogleCredential = async (): Promise<string> => {
  await client.query(
    `insert into "user" ("id", "email") values ($1, $2)`,
    [DELETED_USER, GOOGLE_ACCOUNT_EMAIL],
  );

  const credential = await client.query<{ id: string }>(
    `insert into oauth_credentials
       ("accessToken", "email", "expiresAt", "provider", "refreshToken", "userId")
     values ('access-token-bob', $1, $2, 'google', 'refresh-token-bob', $3)
     returning "id"`,
    [GOOGLE_ACCOUNT_EMAIL, CREDENTIAL_EXPIRES_AT, DELETED_USER],
  );

  const credentialId = credential.rows[0]?.id;

  if (!credentialId) {
    throw new Error("Failed to seed a google oauth credential");
  }

  return credentialId;
};

const seedCalendarAccount = async (credentialId: string): Promise<void> => {
  await client.query(
    `insert into calendar_accounts
       ("accountId", "authType", "email", "oauthCredentialId", "provider", "userId")
     values ($1, 'oauth', $2, $3, 'google', $4)`,
    [GOOGLE_SUB, GOOGLE_ACCOUNT_EMAIL, credentialId, DELETED_USER],
  );
};

interface ResidueRow {
  credentialExpiresAt: Date | null;
  encryptedRefreshToken: string | null;
}

const readResidue = async (): Promise<ResidueRow[]> => {
  const rows = await client.query<ResidueRow>(
    `select "credentialExpiresAt", "encryptedRefreshToken" from deletion_residue`,
  );

  return rows.rows;
};

const { createApiDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");

const runTeardown = async (): Promise<void> => {
  const teardown = createApiDeleteUserSyncTeardown({
    database,
    queue: {
      getJob: () => Promise.resolve(undefined),
      remove: () => Promise.resolve(0),
    },
    redis: {
      del: () => Promise.resolve(1),
      exists: () => Promise.resolve(0),
      set: () => Promise.resolve("OK"),
    },
    residue: createTeardownResidueStore({
      database,
      encryptionKey: ENCRYPTION_KEY,
      now: () => NOW,
    }),
  } as never);

  await teardown(DELETED_USER);
};

describe("oauth grant residue carries the credential expiry", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("persists the stored credential's own expiry so the reaper can refresh the snapshot", async () => {
    const credentialId = await seedGoogleCredential();
    await seedCalendarAccount(credentialId);

    await runTeardown();

    const rows = await readResidue();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.encryptedRefreshToken).not.toBeNull();
    expect(rows[0]?.credentialExpiresAt).not.toBeNull();
    expect(new Date(rows[0]?.credentialExpiresAt ?? 0).toISOString()).toBe(
      CREDENTIAL_EXPIRES_AT.toISOString(),
    );
  });
});
