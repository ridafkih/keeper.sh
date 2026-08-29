import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decryptPassword } from "@keeper.sh/database";
import {
  createTeardownResidueReaper,
  createTeardownResidueStore,
  PUSH_CHANNEL_RESIDUE_KIND,
} from "@keeper.sh/calendar";

const createTombstoneRedis = () => {
  const keys = new Map<string, string>();

  return {
    del: (key: string) => Promise.resolve(Number(keys.delete(key))),
    exists: (key: string) => Promise.resolve(Number(keys.has(key))),
    set: (key: string, value: string) => {
      keys.set(key, value);

      return Promise.resolve("OK");
    },
  };
};

const client = new PGlite();
const database = drizzle(client);

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const DELETED_USER = "user-bob";
const GOOGLE_ACCOUNT_EMAIL = "bob@gmail.com";
const CRASHED_AT = new Date("2026-08-25T06:15:33.956Z");
const CREDENTIAL_EXPIRES_AT = new Date("2027-01-01T00:00:00.000Z");
const A_MINUTE_LATER = new Date(CRASHED_AT.getTime() + 60 * 1000);
const TWO_HOURS_LATER = new Date(CRASHED_AT.getTime() + 2 * 60 * 60 * 1000);
const REPAIR_DEADLINE_MS = 15_000;

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

const seedLiveUserWithGoogleCredential = async (): Promise<void> => {
  await client.query(`insert into "user" ("id", "email") values ($1, $2)`, [
    DELETED_USER,
    GOOGLE_ACCOUNT_EMAIL,
  ]);
  await client.query(
    `insert into oauth_credentials
       ("accessToken", "email", "expiresAt", "provider", "refreshToken", "userId")
     values ('access-token-bob', $1, $2, 'google', 'refresh-token-bob', $3)`,
    [GOOGLE_ACCOUNT_EMAIL, CREDENTIAL_EXPIRES_AT, DELETED_USER],
  );
};

interface StoredResidueRow {
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
  id: string;
  kind: string;
}

const readResidue = async (): Promise<StoredResidueRow[]> => {
  const rows = await client.query<StoredResidueRow>(
    `select "encryptedAccessToken", "encryptedRefreshToken", "id", "kind"
     from deletion_residue order by "kind"`,
  );

  return rows.rows;
};

const residueStoreAt = (moment: Date) =>
  createTeardownResidueStore({
    database,
    encryptionKey: ENCRYPTION_KEY,
    now: () => moment,
  });

const crashDeleteWithoutRollback = async (): Promise<void> => {
  const { createApiDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");

  const teardown = createApiDeleteUserSyncTeardown({
    database,
    queue: {
      getJob: () => Promise.resolve(undefined),
      remove: () => Promise.resolve(0),
    },
    redis: createTombstoneRedis(),
    residue: residueStoreAt(CRASHED_AT),
  } as never);

  await teardown(DELETED_USER);
};

const reaperAt = (moment: Date) =>
  createTeardownResidueReaper({
    countSurvivingAccountLinks: () =>
      Promise.reject(new Error("a purge must never probe provider account links")),
    createRegistrarContext: () =>
      Promise.reject(new Error("a purge must never build a registrar context")),
    deletePolarCustomer: () => Promise.reject(new Error("a purge must never call polar")),
    now: () => moment,
    observe: () => undefined,
    recordError: () => undefined,
    repairDeadlineMs: REPAIR_DEADLINE_MS,
    residue: residueStoreAt(moment),
    resolveRegistrar: () => null,
    revokeOAuthGrant: () =>
      Promise.reject(new Error("a purge must never revoke a live customer's grant")),
    waitForRepairDeadline: () =>
      Promise.reject(new Error("a purge must never wait on a repair deadline")),
  });

describe("oauth grant residue does not outlive the delete that crashed", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedLiveUserWithGoogleCredential();
  });

  it("keeps the grant residue while the delete may still be in flight", async () => {
    await crashDeleteWithoutRollback();

    const outcome = await reaperAt(A_MINUTE_LATER)();
    const rows = await readResidue();

    expect(outcome.purgedIds).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("oauth_grant");
  });

  it("purges the grant residue of a user who still exists two hours after the crash", async () => {
    await crashDeleteWithoutRollback();

    const [stranded] = await readResidue();

    expect(stranded?.kind).toBe("oauth_grant");
    expect(decryptPassword(String(stranded?.encryptedAccessToken), ENCRYPTION_KEY)).toBe(
      "access-token-bob",
    );

    const outcome = await reaperAt(TWO_HOURS_LATER)();

    expect(outcome.purgedIds).toEqual([stranded?.id]);
    expect(await readResidue()).toEqual([]);
  });

  it("leaves push channel residue its full repair window", async () => {
    await residueStoreAt(CRASHED_AT).record({
      credential: {
        accessToken: "access-token-bob",
        expiresAt: CREDENTIAL_EXPIRES_AT,
        refreshToken: "refresh-token-bob",
      },
      kind: PUSH_CHANNEL_RESIDUE_KIND,
      provider: "google",
      providerChannelId: "google-channel-bob",
      providerResourceId: "google-resource-bob",
      userId: DELETED_USER,
    });

    const outcome = await reaperAt(TWO_HOURS_LATER)();
    const rows = await readResidue();

    expect(outcome.purgedIds).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe(PUSH_CHANNEL_RESIDUE_KIND);
  });
});
