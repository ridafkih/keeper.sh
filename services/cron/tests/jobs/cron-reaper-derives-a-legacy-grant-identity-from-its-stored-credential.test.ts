import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OAUTH_GRANT_RESIDUE_KIND, createTeardownResidueStore } from "@keeper.sh/calendar";

const client = new PGlite();
const database = drizzle(client);

const ENCRYPTION_KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const HOUR_MS = 60 * 60 * 1000;

const DELETED_USER_ID = "legacy-person";
const DELETED_ACCOUNT_EMAIL = "legacy-person@example.com";
const DELETED_ACCESS_TOKEN = "legacy-person-access";
const DELETED_REFRESH_TOKEN = "legacy-person-refresh";
const LEGACY_PROVIDER_ACCOUNT_ID = "google-sub-legacy";

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
  "needsReauthentication" boolean not null default false,
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

const recordLegacyGrantResidueWithoutAProviderAccountId = async (): Promise<void> => {
  const recordedAt = new Date(Date.now() - HOUR_MS);

  await createTeardownResidueStore({
    database,
    encryptionKey: ENCRYPTION_KEY,
    now: () => recordedAt,
  }).record({
    accountEmail: DELETED_ACCOUNT_EMAIL,
    credential: {
      accessToken: DELETED_ACCESS_TOKEN,
      expiresAt: new Date(Date.now() + HOUR_MS),
      refreshToken: DELETED_REFRESH_TOKEN,
    },
    kind: OAUTH_GRANT_RESIDUE_KIND,
    provider: "google",
    userId: DELETED_USER_ID,
  });
};

const residueRowCount = async (): Promise<number> => {
  const result = await client.query<{ count: number }>(
    `select count(*)::int as "count" from deletion_residue`,
  );
  const [row] = result.rows;

  if (!row) {
    throw new Error("Counting the residue rows returned no row");
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

const stubProvider = (seenUserInfoTokens: string[], revokedTokens: string[]) => {
  vi.stubGlobal("fetch", (input: Request | string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url === GOOGLE_USERINFO_URL) {
      const authorization = new Headers(init?.headers).get("Authorization") ?? "";
      seenUserInfoTokens.push(authorization.replace("Bearer ", ""));

      return Promise.resolve(
        new Response(JSON.stringify({ id: LEGACY_PROVIDER_ACCOUNT_ID }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      );
    }

    if (url === GOOGLE_REVOKE_URL) {
      const body = init?.body;

      if (!(body instanceof URLSearchParams)) {
        throw new Error("The google revocation was sent without a form body");
      }

      revokedTokens.push(body.get("token") ?? "");

      return Promise.resolve(new Response("", { status: 200 }));
    }

    throw new Error(`The test dialed an unexpected url: ${url}`);
  });
};

describe("the cron reaper derives a legacy grant identity from its stored credential", () => {
  beforeEach(async () => {
    await client.exec(
      `drop table if exists deletion_residue, calendar_accounts, "account", oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
    await recordLegacyGrantResidueWithoutAProviderAccountId();
  });

  it("asks the provider who the stored credential belongs to and revokes the grant", async () => {
    const seenUserInfoTokens: string[] = [];
    const revokedTokens: string[] = [];

    stubProvider(seenUserInfoTokens, revokedTokens);

    await runTick();

    expect(seenUserInfoTokens).toContain(DELETED_ACCESS_TOKEN);
    expect(revokedTokens).toEqual([DELETED_REFRESH_TOKEN]);
    expect(await residueRowCount()).toBe(0);
  });
});
