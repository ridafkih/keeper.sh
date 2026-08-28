import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTeardownResidueStore } from "@keeper.sh/calendar";

const client = new PGlite();
const database = drizzle(client);

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const DELETED_USER = "user-bob";
const GOOGLE_ACCOUNT_EMAIL = "bob@gmail.com";
const FIRST_GOOGLE_SUB = "111111111111111111111";
const SECOND_GOOGLE_SUB = "222222222222222222222";
const NOW = new Date("2026-08-25T06:15:33.956Z");
const EXPIRES_AT = new Date("2027-01-01T00:00:00.000Z");

const recorded = vi.hoisted(() => ({
  reports: [] as string[],
}));

vi.mock("@/context", () => ({
  database,
  encryptionKey: ENCRYPTION_KEY,
}));

vi.mock("@/utils/logging", () => ({
  widelog: {
    error: (error: unknown, ...rest: unknown[]) => {
      recorded.reports.push(
        `${error instanceof Error ? error.message : String(error)} ${JSON.stringify(rest)}`,
      );
    },
    errorFields: (error: unknown, fields: unknown) => {
      recorded.reports.push(
        `${error instanceof Error ? error.message : String(error)} ${JSON.stringify(fields)}`,
      );
    },
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
  await client.query(`insert into "user" ("id", "email") values ($1, $2)`, [
    DELETED_USER,
    GOOGLE_ACCOUNT_EMAIL,
  ]);

  const credential = await client.query<{ id: string }>(
    `insert into oauth_credentials
       ("accessToken", "email", "expiresAt", "provider", "refreshToken", "userId")
     values ('access-token-bob', $1, $2, 'google', 'refresh-token-bob', $3)
     returning "id"`,
    [GOOGLE_ACCOUNT_EMAIL, EXPIRES_AT, DELETED_USER],
  );

  const credentialId = credential.rows[0]?.id;

  if (!credentialId) {
    throw new Error("Failed to seed a google oauth credential");
  }

  return credentialId;
};

const seedCalendarAccount = async (
  credentialId: string,
  providerAccountId: string,
): Promise<void> => {
  await client.query(
    `insert into calendar_accounts
       ("accountId", "authType", "email", "oauthCredentialId", "provider", "userId")
     values ($1, 'oauth', $2, $3, 'google', $4)`,
    [providerAccountId, GOOGLE_ACCOUNT_EMAIL, credentialId, DELETED_USER],
  );
};

interface ResidueRow {
  externalId: string | null;
  providerAccountId: string | null;
}

const readResidue = async (): Promise<ResidueRow[]> => {
  const rows = await client.query<ResidueRow>(
    `select "providerAccountId", "externalId" from deletion_residue`,
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
      exists: () => Promise.resolve(1),
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

describe("conflicting provider identities defer instead of picking the larger one", () => {
  beforeEach(async () => {
    recorded.reports.length = 0;
    await resetDatabase();
  });

  it("yields no provider account id and reports the conflict when two calendar rows disagree", async () => {
    const credentialId = await seedGoogleCredential();
    await seedCalendarAccount(credentialId, FIRST_GOOGLE_SUB);
    await seedCalendarAccount(credentialId, SECOND_GOOGLE_SUB);

    await runTeardown();

    const rows = await readResidue();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.externalId).toBe(credentialId);
    expect(rows[0]?.providerAccountId).toBeNull();

    const conflictReports = recorded.reports.filter(
      (report) =>
        report.includes(FIRST_GOOGLE_SUB)
        && report.includes(SECOND_GOOGLE_SUB)
        && report.includes(credentialId)
        && report.includes(DELETED_USER),
    );

    expect(conflictReports).not.toEqual([]);
  });

  it("still carries the identity when both calendar rows agree on it", async () => {
    const credentialId = await seedGoogleCredential();
    await seedCalendarAccount(credentialId, FIRST_GOOGLE_SUB);
    await seedCalendarAccount(credentialId, FIRST_GOOGLE_SUB);

    await runTeardown();

    const rows = await readResidue();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.providerAccountId).toBe(FIRST_GOOGLE_SUB);
    expect(recorded.reports.filter((report) => report.includes(FIRST_GOOGLE_SUB))).toEqual(
      [],
    );
  });
});
