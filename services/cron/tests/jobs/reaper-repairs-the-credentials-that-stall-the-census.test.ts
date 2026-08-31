import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OAUTH_GRANT_RESIDUE_KIND,
  RESIDUE_CENSUS_STALLED_SLUG,
  createTeardownResidueStore,
} from "@keeper.sh/calendar";
import type { TeardownResidueRecord } from "@keeper.sh/calendar";
import { countSurvivingAccountLinks } from "../../src/jobs/reap-teardown-residue";

const client = new PGlite();
const database = drizzle(client);

const ENCRYPTION_KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const HOUR_MS = 60 * 60 * 1000;

const DELETED_USER_ID = "deleted-person";
const DELETED_ACCOUNT_EMAIL = "deleted-person@example.com";
const DELETED_PROVIDER_ACCOUNT_ID = "google-sub-deleted";
const DELETED_REFRESH_TOKEN = "deleted-person-refresh";

const STRANGER_EMAIL = "stranger@workspace.example";
const STRANGER_ACCESS_TOKEN = "stranger-access";
const STRANGER_CREDENTIAL_ID = "44444444-4444-4444-4444-444444444444";
const STRANGER_CALENDAR_ROW_ID = "88888888-8888-8888-8888-888888888888";
const STRANGER_PROVIDER_ACCOUNT_ID = "google-sub-stranger";

const recorded = vi.hoisted(() => ({
  errorSlugs: [] as string[],
}));

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
    errorFields: (_error: unknown, fields: { slug: string }) => {
      recorded.errorSlugs.push(fields.slug);
    },
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

const deletedCustomerResidueRecord = (): TeardownResidueRecord => ({
  accountEmail: DELETED_ACCOUNT_EMAIL,
  createdAt: new Date(Date.now() - HOUR_MS),
  credential: {
    accessToken: "deleted-person-access",
    expiresAt: new Date(Date.now() + HOUR_MS),
    refreshToken: DELETED_REFRESH_TOKEN,
  },
  expiresAt: new Date(Date.now() + HOUR_MS),
  id: "11111111-1111-1111-1111-111111111111",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  providerAccountId: DELETED_PROVIDER_ACCOUNT_ID,
  userId: DELETED_USER_ID,
});

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

const insertStrangerWhoseCalendarRowNamesNoAccount = async (): Promise<void> => {
  await client.query(
    `insert into "user" ("email", "id", "name") values ($1, 'stranger', 'Stranger')`,
    [STRANGER_EMAIL],
  );
  await client.query(
    `insert into oauth_credentials ("accessToken", "createdAt", "email", "expiresAt", "id", "provider", "refreshToken", "userId")
     values ($1, now() - interval '2 hours', $2, now() + interval '6 hours', $3, 'google', 'stranger-refresh', 'stranger')`,
    [STRANGER_ACCESS_TOKEN, STRANGER_EMAIL, STRANGER_CREDENTIAL_ID],
  );
  await client.query(
    `insert into calendar_accounts ("accountId", "email", "id", "oauthCredentialId", "provider", "userId")
     values (null, $1, $2, $3, 'google', 'stranger')`,
    [STRANGER_EMAIL, STRANGER_CALENDAR_ROW_ID, STRANGER_CREDENTIAL_ID],
  );
};

const strangerCalendarAccountId = async (): Promise<string | null> => {
  const result = await client.query<{ accountId: string | null }>(
    `select "accountId" from calendar_accounts where "id" = $1`,
    [STRANGER_CALENDAR_ROW_ID],
  );
  const [row] = result.rows;

  if (!row) {
    throw new Error("The stranger's calendar account row disappeared");
  }

  return row.accountId;
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

const stubProvider = (
  userInfo: () => Response,
  seenUserInfoTokens: string[],
  revokedTokens: string[],
) => {
  vi.stubGlobal("fetch", (input: Request | string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url === GOOGLE_USERINFO_URL) {
      const authorization = new Headers(init?.headers).get("Authorization") ?? "";
      seenUserInfoTokens.push(authorization.replace("Bearer ", ""));

      return Promise.resolve(userInfo());
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

describe("the reaper repairs the credentials that stall the census", () => {
  beforeEach(async () => {
    recorded.errorSlugs.length = 0;
    await client.exec(
      `drop table if exists deletion_residue, calendar_accounts, "account", oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
    await recordDeletedCustomerGrantResidue();
    await insertStrangerWhoseCalendarRowNamesNoAccount();
  });

  it("writes the provider account id the provider answers with, unstalling the census", async () => {
    const seenUserInfoTokens: string[] = [];
    const revokedTokens: string[] = [];

    stubProvider(
      () =>
        new Response(
          JSON.stringify({ email: STRANGER_EMAIL, id: STRANGER_PROVIDER_ACCOUNT_ID }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      seenUserInfoTokens,
      revokedTokens,
    );

    await runTick();

    expect(seenUserInfoTokens).toContain(STRANGER_ACCESS_TOKEN);
    expect(await strangerCalendarAccountId()).toBe(STRANGER_PROVIDER_ACCOUNT_ID);

    const census = await countSurvivingAccountLinks(
      database,
      deletedCustomerResidueRecord(),
    );

    expect(census.blockingCredentialIds).toEqual([]);
    expect(census.identityResolved).toBe(true);
  });

  it("leaves the row untouched and keeps the census alarm when the provider fails fast", async () => {
    const seenUserInfoTokens: string[] = [];
    const revokedTokens: string[] = [];

    stubProvider(
      () => new Response("no", { status: 401 }),
      seenUserInfoTokens,
      revokedTokens,
    );

    await runTick();

    expect(await strangerCalendarAccountId()).toBeNull();
    expect(revokedTokens).toEqual([]);
    expect(await residueRowCount()).toBe(1);
    expect(recorded.errorSlugs).toContain(RESIDUE_CENSUS_STALLED_SLUG);

    const census = await countSurvivingAccountLinks(
      database,
      deletedCustomerResidueRecord(),
    );

    expect(census.blockingCredentialIds).toEqual([STRANGER_CREDENTIAL_ID]);
    expect(census.identityResolved).toBe(false);
  });
});
