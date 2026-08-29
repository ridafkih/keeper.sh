import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OAUTH_GRANT_RESIDUE_KIND, createTeardownResidueStore } from "@keeper.sh/calendar";

const client = new PGlite();
const database = drizzle(client);

const ENCRYPTION_KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const HOUR_MS = 60 * 60 * 1000;

const DELETED_USER_ID = "deleted-person";
const DELETED_ACCOUNT_EMAIL = "deleted-person@example.com";
const DELETED_PROVIDER_ACCOUNT_ID = "google-sub-deleted";
const DELETED_REFRESH_TOKEN = "deleted-person-refresh";
const STRANGER_EMAIL = "stranger@workspace.example";

const revokedTokens: string[] = [];

vi.mock("@/context", () => ({
  database,
  polarClient: null,
  webhookConfig: null,
}));

vi.mock("@/env", () => ({
  default: { ENCRYPTION_KEY },
}));

vi.mock("@/utils/logging", () => ({
  context: (run: () => Promise<unknown>) => run(),
  widelog: {
    append: () => null,
    count: () => null,
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    max: () => null,
    min: () => null,
    set: () => null,
    setFields: () => null,
    time: {
      measure: <TResult>(_key: string, run: () => Promise<TResult>) => run(),
    },
  },
}));

const DDL = `
create table "user" (
  "createdAt" timestamptz not null default now(),
  "email" text not null unique,
  "emailVerified" boolean not null default false,
  "id" text primary key,
  "image" text,
  "name" text not null,
  "updatedAt" timestamptz not null default now(),
  "username" text unique
);
create table "account" (
  "accessToken" text,
  "accessTokenExpiresAt" timestamptz,
  "accountId" text not null,
  "createdAt" timestamptz not null default now(),
  "id" text primary key,
  "idToken" text,
  "password" text,
  "providerId" text not null,
  "refreshToken" text,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "updatedAt" timestamptz not null default now(),
  "userId" text not null references "user"("id") on delete cascade
);
create table oauth_credentials (
  "accessToken" text not null,
  "createdAt" timestamptz not null default now(),
  "email" text,
  "expiresAt" timestamptz not null,
  "id" uuid primary key default gen_random_uuid(),
  "needsReauthentication" boolean not null default false,
  "provider" text not null,
  "refreshToken" text not null,
  "updatedAt" timestamptz not null default now(),
  "userId" text not null references "user"("id") on delete cascade
);
create table calendar_accounts (
  "accountId" text,
  "email" text,
  "id" uuid primary key default gen_random_uuid(),
  "oauthCredentialId" uuid references oauth_credentials("id") on delete cascade,
  "provider" text not null,
  "userId" text not null references "user"("id") on delete cascade
);
create table deletion_residue (
  "accountEmail" text,
  "attempts" integer not null default 0,
  "createdAt" timestamptz not null default now(),
  "credentialExpiresAt" timestamptz,
  "encryptedAccessToken" text,
  "encryptedRefreshToken" text,
  "expiresAt" timestamptz not null,
  "externalId" text,
  "id" uuid primary key default gen_random_uuid(),
  "kind" text not null,
  "lastAttemptAt" timestamptz,
  "nextAttemptAt" timestamptz,
  "provider" text,
  "providerAccountId" text,
  "providerChannelId" text,
  "providerResourceId" text,
  "userId" text not null
);
`;

const recordDeletedCustomerGrantResidue = async (): Promise<void> => {
  const recordedAt = new Date(Date.now() - HOUR_MS);

  await createTeardownResidueStore({
    database,
    encryptionKey: ENCRYPTION_KEY,
    now: () => recordedAt,
  }).record({
    accountEmail: DELETED_ACCOUNT_EMAIL,
    credential: {
      accessToken: "deleted-person-access",
      expiresAt: new Date(Date.now() + HOUR_MS),
      refreshToken: DELETED_REFRESH_TOKEN,
    },
    kind: OAUTH_GRANT_RESIDUE_KIND,
    provider: "google",
    providerAccountId: DELETED_PROVIDER_ACCOUNT_ID,
    userId: DELETED_USER_ID,
  });
};

const insertStrangerOrphanCredential = async (ageMs: number): Promise<void> => {
  await client.query(
    `insert into "user" ("email", "id", "name") values ($1, 'stranger', 'Stranger')`,
    [STRANGER_EMAIL],
  );
  await client.query(
    `insert into oauth_credentials ("accessToken", "createdAt", "email", "expiresAt", "provider", "refreshToken", "userId")
     values ('stranger-access', $1, $2, now() + interval '1 hour', 'google', 'stranger-refresh', 'stranger')`,
    [new Date(Date.now() - ageMs).toISOString(), STRANGER_EMAIL],
  );
};

const residueIdsRemaining = async (): Promise<string[]> => {
  const result = await client.query<{ id: string }>(`select "id" from deletion_residue`);

  return result.rows.map((row) => row.id);
};

const strangerCredentialCount = async (): Promise<number> => {
  const result = await client.query<{ count: number }>(
    `select count(*)::int as "count" from oauth_credentials where "userId" = 'stranger'`,
  );
  const [row] = result.rows;

  if (!row) {
    throw new Error("Counting the stranger's credentials returned no row");
  }

  return row.count;
};

const runTick = async (): Promise<void> => {
  const job = await import("../../src/jobs/reap-teardown-residue");
  const { callback } = job.default;

  if (!callback) {
    throw new Error("The teardown residue job exports no cron callback");
  }

  await callback();
};

describe("the orphan credential sweep runs before the reaper on the same tick", () => {
  beforeEach(async () => {
    revokedTokens.length = 0;
    vi.stubGlobal("fetch", (input: Request | string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url !== GOOGLE_REVOKE_URL) {
        throw new Error(`The test dialed an unexpected url: ${url}`);
      }

      const body = init?.body;

      if (!(body instanceof URLSearchParams)) {
        throw new Error("The google revocation was sent without a form body");
      }

      revokedTokens.push(body.get("token") ?? "");

      return Promise.resolve(new Response("", { status: 200 }));
    });

    await client.exec(
      `drop table if exists deletion_residue, calendar_accounts, "account", oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
  });

  it("sweeps a stale orphan and revokes the deleted customer's grant on the same tick", async () => {
    await recordDeletedCustomerGrantResidue();
    await insertStrangerOrphanCredential(2 * HOUR_MS);

    await runTick();

    expect(revokedTokens).toEqual([DELETED_REFRESH_TOKEN]);
    expect(await residueIdsRemaining()).toEqual([]);
    expect(await strangerCredentialCount()).toBe(0);
  });

  it("still defers while the orphan credential is younger than the safety age", async () => {
    await recordDeletedCustomerGrantResidue();
    await insertStrangerOrphanCredential(60 * 1000);

    await runTick();

    expect(revokedTokens).toEqual([]);
    expect(await residueIdsRemaining()).toHaveLength(1);
    expect(await strangerCredentialCount()).toBe(1);
  });
});
