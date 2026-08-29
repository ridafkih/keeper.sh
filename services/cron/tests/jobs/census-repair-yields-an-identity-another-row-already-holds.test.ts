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

const DELETED_USER_ID = "deleted-person";
const DELETED_ACCOUNT_EMAIL = "deleted-person@example.com";
const DELETED_PROVIDER_ACCOUNT_ID = "google-sub-deleted";
const RESIDUE_ID = "11111111-1111-1111-1111-111111111111";

const RECONNECTOR_USER_ID = "reconnector";
const RECONNECTOR_EMAIL = "reconnector@workspace.example";
const RECONNECTOR_PROVIDER_ACCOUNT_ID = "google-sub-reconnector";
const FIRST_CREDENTIAL_ID = "22222222-2222-2222-2222-222222222222";
const SECOND_CREDENTIAL_ID = "33333333-3333-3333-3333-333333333333";
const FIRST_CALENDAR_ROW_ID = "44444444-4444-4444-4444-444444444444";
const SECOND_CALENDAR_ROW_ID = "55555555-5555-5555-5555-555555555555";

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
create unique index "calendar_accounts_provider_account_idx" on calendar_accounts ("userId","provider","accountId");
`;

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

const insertReconnectedGrantPair = async (): Promise<void> => {
  await client.query(
    `insert into "user" ("email", "id", "name") values ($1, $2, 'Reconnector')`,
    [RECONNECTOR_EMAIL, RECONNECTOR_USER_ID],
  );

  const pairs: [string, string, string][] = [
    [FIRST_CREDENTIAL_ID, FIRST_CALENDAR_ROW_ID, "first-access"],
    [SECOND_CREDENTIAL_ID, SECOND_CALENDAR_ROW_ID, "second-access"],
  ];

  for (const [credentialId, calendarRowId, accessToken] of pairs) {
    await client.query(
      `insert into oauth_credentials ("accessToken", "createdAt", "email", "expiresAt", "id", "provider", "refreshToken", "userId")
       values ($1, now() - interval '2 hours', null, now() + interval '6 hours', $2, 'google', $3, $4)`,
      [accessToken, credentialId, `${accessToken}-refresh`, RECONNECTOR_USER_ID],
    );
    await client.query(
      `insert into calendar_accounts ("accountId", "email", "id", "oauthCredentialId", "provider", "userId")
       values ($1, null, $2, $3, 'google', $4)`,
      [calendarRowId, calendarRowId, credentialId, RECONNECTOR_USER_ID],
    );
  }
};

const stubUserInfoAnsweringOneAccountForBothGrants = (): void => {
  vi.stubGlobal("fetch", (input: Request | string | URL) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url === GOOGLE_USERINFO_URL) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            email: RECONNECTOR_EMAIL,
            id: RECONNECTOR_PROVIDER_ACCOUNT_ID,
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    }

    throw new Error(`The test dialed an unexpected url: ${url}`);
  });
};

describe("census repair yields an identity another calendar row already holds", () => {
  beforeEach(async () => {
    recorded.errorSlugs.length = 0;
    await client.exec(
      `drop table if exists calendar_accounts, "account", oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
    await insertReconnectedGrantPair();
    stubUserInfoAnsweringOneAccountForBothGrants();
  });

  it("unstalls the census instead of colliding on the per-user provider account index", async () => {
    const stalled = await countSurvivingAccountLinks(
      database,
      deletedCustomerResidueRecord(),
    );

    expect(stalled.identityResolved).toBe(false);
    expect(stalled.blockingCredentialIds.toSorted()).toEqual(
      [FIRST_CREDENTIAL_ID, SECOND_CREDENTIAL_ID].toSorted(),
    );

    const tally = await repairCensusBlockingCredentials(
      database,
      stalled.blockingCredentialIds,
    );

    expect(tally.repaired).toBe(tally.attempted);
    expect(recorded.errorSlugs).not.toContain(CENSUS_REPAIR_FAILED_SLUG);

    const afterRepair = await countSurvivingAccountLinks(
      database,
      deletedCustomerResidueRecord(),
    );

    expect(afterRepair.blockingCredentialIds).toEqual([]);
    expect(afterRepair.identityResolved).toBe(true);
    expect(afterRepair.coHolders).toBe(0);
  });
});
