import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { repairCensusBlockingCredentials } from "../../src/jobs/reap-teardown-residue";

const client = new PGlite();
const database = drizzle(client);

const ENCRYPTION_KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

const SURVIVOR_EMAIL = "survivor@workspace.example";
const SURVIVOR_CREDENTIAL_ID = "44444444-4444-4444-4444-444444444444";
const SURVIVOR_CALENDAR_ROW_ID = "88888888-8888-8888-8888-888888888888";
const SURVIVOR_PROVIDER_ACCOUNT_ID = "google-sub-survivor";
const STALE_ACCESS_TOKEN = "survivor-access-v1";
const ROTATING_REFRESH_TOKEN = "survivor-refresh-v1";
const PEER_ACCESS_TOKEN = "survivor-access-v2";

const observed = vi.hoisted(() => ({
  lockKeys: [] as string[],
  redeemedRefreshTokens: [] as string[],
  userInfoTokens: [] as string[],
}));

const peerPersistsItsRefreshedCredential = async (): Promise<void> => {
  await client.query(
    `update oauth_credentials
       set "accessToken" = $1, "expiresAt" = now() + interval '6 hours'
     where "id" = $2`,
    [PEER_ACCESS_TOKEN, SURVIVOR_CREDENTIAL_ID],
  );
};

vi.mock("@/context", () => ({
  database,
  polarClient: null,
  refreshLockStore: {
    release: () => Promise.resolve(),
    tryAcquire: async (key: string) => {
      observed.lockKeys.push(key);
      await peerPersistsItsRefreshedCredential();
      return false;
    },
  },
  webhookConfig: null,
}));

vi.mock("@/env", () => ({
  default: {
    ENCRYPTION_KEY,
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
  },
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
  "reauthenticationSource" text,
  "userId" text not null references "user"("id") on delete cascade
);
`;

const insertSurvivorWhoseCalendarRowNamesNoAccount = async (): Promise<void> => {
  await client.query(
    `insert into "user" ("email", "id", "name") values ($1, 'survivor', 'Survivor')`,
    [SURVIVOR_EMAIL],
  );
  await client.query(
    `insert into oauth_credentials ("accessToken", "createdAt", "email", "expiresAt", "id", "provider", "refreshToken", "userId")
     values ($1, now() - interval '3 hours', $2, now() - interval '1 hour', $3, 'google', $4, 'survivor')`,
    [STALE_ACCESS_TOKEN, SURVIVOR_EMAIL, SURVIVOR_CREDENTIAL_ID, ROTATING_REFRESH_TOKEN],
  );
  await client.query(
    `insert into calendar_accounts ("accountId", "email", "id", "oauthCredentialId", "provider", "userId")
     values ($1, $2, $3, $4, 'google', 'survivor')`,
    [
      SURVIVOR_CALENDAR_ROW_ID,
      SURVIVOR_EMAIL,
      SURVIVOR_CALENDAR_ROW_ID,
      SURVIVOR_CREDENTIAL_ID,
    ],
  );
};

const survivorCalendarAccountId = async (): Promise<string | null> => {
  const result = await client.query<{ accountId: string | null }>(
    `select "accountId" from calendar_accounts where "id" = $1`,
    [SURVIVOR_CALENDAR_ROW_ID],
  );
  const [row] = result.rows;

  if (!row) {
    throw new Error("The survivor's calendar account row disappeared");
  }

  return row.accountId;
};

const survivorNeedsReauthentication = async (): Promise<boolean> => {
  const result = await client.query<{ needsReauthentication: boolean }>(
    `select "needsReauthentication" from calendar_accounts where "id" = $1`,
    [SURVIVOR_CALENDAR_ROW_ID],
  );
  const [row] = result.rows;

  if (!row) {
    throw new Error("The survivor's calendar account row disappeared");
  }

  return row.needsReauthentication;
};

const stubProvider = (): void => {
  vi.stubGlobal("fetch", (input: Request | string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url === GOOGLE_TOKEN_URL) {
      const body = init?.body;

      if (!(body instanceof URLSearchParams)) {
        throw new Error("The google token refresh was sent without a form body");
      }

      observed.redeemedRefreshTokens.push(body.get("refresh_token") ?? "");

      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "cron-rotated-access",
            expires_in: 3600,
            refresh_token: "survivor-refresh-v2",
            token_type: "Bearer",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    }

    if (url === GOOGLE_USERINFO_URL) {
      const authorization = new Headers(init?.headers).get("Authorization") ?? "";
      observed.userInfoTokens.push(authorization.replace("Bearer ", ""));

      return Promise.resolve(
        new Response(
          JSON.stringify({ email: SURVIVOR_EMAIL, id: SURVIVOR_PROVIDER_ACCOUNT_ID }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    }

    throw new Error(`The test dialed an unexpected url: ${url}`);
  });
};

describe("the census repair refreshes under the credential refresh lock", () => {
  beforeEach(async () => {
    observed.lockKeys.length = 0;
    observed.redeemedRefreshTokens.length = 0;
    observed.userInfoTokens.length = 0;
    await client.exec(
      `drop table if exists calendar_accounts, oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
    await insertSurvivorWhoseCalendarRowNamesNoAccount();
    stubProvider();
  });

  it("adopts the token a peer already persisted instead of redeeming the refresh token again", async () => {
    const tally = await repairCensusBlockingCredentials(database, [SURVIVOR_CREDENTIAL_ID]);

    expect(observed.redeemedRefreshTokens).toEqual([]);
    expect(observed.lockKeys).toContain(`oauth:refresh-lock:${SURVIVOR_CREDENTIAL_ID}`);
    expect(observed.userInfoTokens).toEqual([PEER_ACCESS_TOKEN]);
    expect(await survivorCalendarAccountId()).toBe(SURVIVOR_PROVIDER_ACCOUNT_ID);
    expect(await survivorNeedsReauthentication()).toBe(false);
    expect(tally).toEqual({ attempted: 1, remaining: 0, repaired: 1 });
  });
});
