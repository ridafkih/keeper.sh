import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { repairCensusBlockingCredentials } from "../../src/jobs/reap-teardown-residue";

const client = new PGlite();
const database = drizzle(client);

const ENCRYPTION_KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

const SURVIVOR_EMAIL = "reauth-flagged@workspace.example";
const SURVIVOR_ACCESS_TOKEN = "reauth-flagged-access";
const SURVIVOR_CREDENTIAL_ID = "55555555-5555-5555-5555-555555555555";
const SURVIVOR_CALENDAR_ROW_ID = "99999999-9999-9999-9999-999999999999";
const SURVIVOR_PROVIDER_ACCOUNT_ID = "google-sub-reauth-flagged";

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
`;

const insertSurvivorWhoseCredentialIsFlaggedForReauthentication =
  async (): Promise<void> => {
    await client.query(
      `insert into "user" ("email", "id", "name") values ($1, 'survivor', 'Survivor')`,
      [SURVIVOR_EMAIL],
    );
    await client.query(
      `insert into oauth_credentials ("accessToken", "createdAt", "email", "expiresAt", "id", "needsReauthentication", "provider", "refreshToken", "userId")
       values ($1, now() - interval '2 hours', $2, now() + interval '6 hours', $3, true, 'google', 'survivor-refresh', 'survivor')`,
      [SURVIVOR_ACCESS_TOKEN, SURVIVOR_EMAIL, SURVIVOR_CREDENTIAL_ID],
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

const stubUserInfo = (seenUserInfoTokens: string[]) => {
  vi.stubGlobal("fetch", (input: Request | string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url === GOOGLE_USERINFO_URL) {
      const authorization = new Headers(init?.headers).get("Authorization") ?? "";
      seenUserInfoTokens.push(authorization.replace("Bearer ", ""));

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

describe("census repair attempts a reauth flagged blocking credential", () => {
  beforeEach(async () => {
    recorded.errorSlugs.length = 0;
    await client.exec(
      `drop table if exists calendar_accounts, oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
    await insertSurvivorWhoseCredentialIsFlaggedForReauthentication();
  });

  it("stamps the provider account id even though the credential is flagged for reauthentication", async () => {
    const seenUserInfoTokens: string[] = [];

    stubUserInfo(seenUserInfoTokens);

    const tally = await repairCensusBlockingCredentials(database, [
      SURVIVOR_CREDENTIAL_ID,
    ]);

    expect(tally).toEqual({ attempted: 1, repaired: 1 });
    expect(seenUserInfoTokens).toContain(SURVIVOR_ACCESS_TOKEN);
    expect(await survivorCalendarAccountId()).toBe(SURVIVOR_PROVIDER_ACCOUNT_ID);
  });
});
