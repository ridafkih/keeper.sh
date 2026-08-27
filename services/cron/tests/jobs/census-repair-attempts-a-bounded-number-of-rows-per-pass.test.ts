import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OAUTH_GRANT_RESIDUE_KIND } from "@keeper.sh/calendar";
import type { TeardownResidueRecord } from "@keeper.sh/calendar";
import {
  countSurvivingAccountLinks,
  repairCensusBlockingCredentials,
} from "../../src/jobs/reap-teardown-residue";

const client = new PGlite();
const database = drizzle(client);

const ENCRYPTION_KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const HOUR_MS = 60 * 60 * 1000;
const CENSUS_REPAIR_FAILED_SLUG = "teardown-residue-census-repair-failed";

const CENSUS_REPAIR_BATCH_LIMIT = 10;
const LIVE_CUSTOMER_OVERFLOW = 5;
const LIVE_CUSTOMER_COUNT = CENSUS_REPAIR_BATCH_LIMIT + LIVE_CUSTOMER_OVERFLOW;

const DELETED_USER_ID = "deleted-person";
const DELETED_ACCOUNT_EMAIL = "deleted-person@example.com";
const DELETED_PROVIDER_ACCOUNT_ID = "google-sub-deleted";
const RESIDUE_ID = "11111111-1111-1111-1111-111111111111";

const recorded = vi.hoisted(() => ({
  errorSlugs: [] as string[],
  userInfoTokens: [] as string[],
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
create unique index "calendar_accounts_provider_account_idx" on calendar_accounts ("userId","provider","accountId");
`;

const liveCustomerIndexes = () =>
  Array.from({ length: LIVE_CUSTOMER_COUNT }, (_unused, index) => index);

const paddedIndex = (index: number) => String(index).padStart(2, "0");

const credentialIdFor = (index: number) =>
  `22222222-2222-2222-2222-2222222222${paddedIndex(index)}`;

const calendarRowIdFor = (index: number) =>
  `33333333-3333-3333-3333-3333333333${paddedIndex(index)}`;

const accessTokenFor = (index: number) => `live-access-${paddedIndex(index)}`;

const providerAccountIdFor = (index: number) => `google-sub-live-${paddedIndex(index)}`;

const deletedCustomerResidueRecord = (): TeardownResidueRecord => ({
  accountEmail: DELETED_ACCOUNT_EMAIL,
  createdAt: new Date(Date.now() - HOUR_MS),
  credential: {
    accessToken: "deleted-person-access",
    expiresAt: new Date(Date.now() + HOUR_MS),
    refreshToken: "deleted-person-refresh",
  },
  expiresAt: new Date(Date.now() + HOUR_MS),
  id: RESIDUE_ID,
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  providerAccountId: DELETED_PROVIDER_ACCOUNT_ID,
  userId: DELETED_USER_ID,
});

const insertUnrelatedLiveCustomers = async (): Promise<void> => {
  for (const index of liveCustomerIndexes()) {
    const userId = `live-customer-${paddedIndex(index)}`;

    await client.query(
      `insert into "user" ("email", "id", "name") values ($1, $2, 'Live Customer')`,
      [`${userId}@workspace.example`, userId],
    );
    await client.query(
      `insert into oauth_credentials ("accessToken", "createdAt", "email", "expiresAt", "id", "provider", "refreshToken", "userId")
       values ($1, now() - interval '2 hours', null, now() + interval '6 hours', $2, 'google', $3, $4)`,
      [accessTokenFor(index), credentialIdFor(index), `${accessTokenFor(index)}-refresh`, userId],
    );
    await client.query(
      `insert into calendar_accounts ("accountId", "email", "id", "oauthCredentialId", "provider", "userId")
       values ($1, null, $2, $3, 'google', $4)`,
      [calendarRowIdFor(index), calendarRowIdFor(index), credentialIdFor(index), userId],
    );
  }
};

const bearerTokenOf = (init: RequestInit | undefined): string => {
  const authorization = new Headers(init?.headers).get("Authorization");

  if (!authorization) {
    throw new Error("The census repair dialed user info without a bearer token");
  }

  return authorization.replace("Bearer ", "");
};

const stubUserInfoCountingEveryRoundTrip = (): void => {
  vi.stubGlobal("fetch", (input: Request | string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url !== GOOGLE_USERINFO_URL) {
      throw new Error(`The test dialed an unexpected url: ${url}`);
    }

    const token = bearerTokenOf(init);
    recorded.userInfoTokens.push(token);

    const index = liveCustomerIndexes().find(
      (candidate) => accessTokenFor(candidate) === token,
    );

    if (index === undefined) {
      throw new Error(`The census repair dialed user info with an unknown token: ${token}`);
    }

    return Promise.resolve(
      new Response(
        JSON.stringify({
          email: `live-customer-${paddedIndex(index)}@workspace.example`,
          id: providerAccountIdFor(index),
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      ),
    );
  });
};

const countRepairedCalendarRows = async (): Promise<number> => {
  const { rows } = await client.query<{ repaired: number }>(
    `select count(*)::int as repaired from calendar_accounts where "accountId" like 'google-sub-live-%'`,
  );

  return rows[0]?.repaired ?? 0;
};

describe("one census repair pass touches a bounded number of blocking rows", () => {
  beforeEach(async () => {
    recorded.errorSlugs.length = 0;
    recorded.userInfoTokens.length = 0;
    await client.exec(
      `drop table if exists calendar_accounts, "account", oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
    await insertUnrelatedLiveCustomers();
    stubUserInfoCountingEveryRoundTrip();
  });

  it("repairs one batch per pass and reports the remainder for the next tick", async () => {
    const stalled = await countSurvivingAccountLinks(
      database,
      deletedCustomerResidueRecord(),
    );

    expect(stalled.blockingCredentialIds).toHaveLength(LIVE_CUSTOMER_COUNT);

    const firstPass = await repairCensusBlockingCredentials(
      database,
      stalled.blockingCredentialIds,
    );

    expect(firstPass.attempted).toBe(CENSUS_REPAIR_BATCH_LIMIT);
    expect(firstPass.repaired).toBe(CENSUS_REPAIR_BATCH_LIMIT);
    expect(firstPass.remaining).toBe(LIVE_CUSTOMER_OVERFLOW);
    expect(recorded.userInfoTokens).toHaveLength(CENSUS_REPAIR_BATCH_LIMIT);
    expect(await countRepairedCalendarRows()).toBe(CENSUS_REPAIR_BATCH_LIMIT);
    expect(recorded.errorSlugs).not.toContain(CENSUS_REPAIR_FAILED_SLUG);

    const secondPass = await repairCensusBlockingCredentials(
      database,
      stalled.blockingCredentialIds,
    );

    expect(secondPass.attempted).toBe(LIVE_CUSTOMER_OVERFLOW);
    expect(secondPass.repaired).toBe(LIVE_CUSTOMER_OVERFLOW);
    expect(secondPass.remaining).toBe(0);
    expect(recorded.userInfoTokens).toHaveLength(LIVE_CUSTOMER_COUNT);
    expect(await countRepairedCalendarRows()).toBe(LIVE_CUSTOMER_COUNT);
    expect(recorded.errorSlugs).not.toContain(CENSUS_REPAIR_FAILED_SLUG);
  });
});
