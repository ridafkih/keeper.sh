import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = new PGlite();
const database = drizzle(client);

vi.mock("@/context", () => ({
  database,
}));

const { createOAuthSourceCredential } = await import(
  "../../../api/src/utils/oauth-source-credentials"
);
const { sweepOrphanedOAuthCredentials } = await import("../../src/jobs/reap-teardown-residue");

const SAFETY_AGE_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

const RECONNECTING_EMAIL = "reconnecting@workspace.example";
const ABANDONED_EMAIL = "abandoned@workspace.example";

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
  "oauthCredentialId" uuid references oauth_credentials("id") on delete cascade,
  "provider" text not null,
  "userId" text not null references "user"("id") on delete cascade
);
`;

const seedCredential = async (email: string, createdAt: Date): Promise<string> => {
  const result = await client.query<{ id: string }>(
    `insert into oauth_credentials ("accessToken", "createdAt", "email", "expiresAt", "provider", "refreshToken", "userId")
     values ('stale-access', $1, $2, $3, 'google', 'stale-refresh', 'user-a')
     returning "id"`,
    [createdAt.toISOString(), email, new Date(Date.now() + ONE_HOUR_MS).toISOString()],
  );

  const [row] = result.rows;

  if (!row) {
    throw new Error(`Seeding the google credential for ${email} returned no row`);
  }

  return row.id;
};

const sweepClockOf = async (credentialId: string): Promise<Date> => {
  const result = await client.query<{ createdAt: Date }>(
    `select "createdAt" from oauth_credentials where "id" = $1`,
    [credentialId],
  );

  const [row] = result.rows;

  if (!row) {
    throw new Error(`Credential ${credentialId} is gone, so it has no sweep clock to read`);
  }

  return new Date(row.createdAt);
};

const remainingCredentialEmails = async (): Promise<string[]> => {
  const result = await client.query<{ email: string }>(
    `select "email" from oauth_credentials order by "email"`,
  );

  return result.rows.map((row) => row.email);
};

describe("adopting an existing credential resets its orphan sweep clock", () => {
  beforeEach(async () => {
    await client.exec(`drop table if exists calendar_accounts, oauth_credentials, "user" cascade;`);
    await client.exec(DDL);
    await client.query(
      `insert into "user" ("email", "id", "name") values ('user-a@keeper.sh', 'user-a', 'User A')`,
    );
  });

  it("marks an adopted credential as freshly in use", async () => {
    const adoptedAtOrLater = new Date(Date.now() - 1000);
    const credentialId = await seedCredential(
      RECONNECTING_EMAIL,
      new Date(Date.now() - TWO_HOURS_MS),
    );

    const returnedId = await createOAuthSourceCredential(
      "user-a",
      {
        accessToken: "fresh-access",
        email: RECONNECTING_EMAIL,
        expiresAt: new Date(Date.now() + ONE_HOUR_MS),
        provider: "google",
        refreshToken: "fresh-refresh",
      },
      {
        onCredentialCreated: () => {
          throw new Error("adoption must reuse the existing credential, not insert a new one");
        },
      },
    );

    const sweepClock = await sweepClockOf(credentialId);

    expect(returnedId).toBe(credentialId);
    expect(sweepClock.getTime()).toBeGreaterThanOrEqual(adoptedAtOrLater.getTime());
  });

  it("leaves the adopted credential in place while still sweeping an untouched orphan", async () => {
    await seedCredential(RECONNECTING_EMAIL, new Date(Date.now() - TWO_HOURS_MS));
    await seedCredential(ABANDONED_EMAIL, new Date(Date.now() - TWO_HOURS_MS));

    await createOAuthSourceCredential(
      "user-a",
      {
        accessToken: "fresh-access",
        email: RECONNECTING_EMAIL,
        expiresAt: new Date(Date.now() + ONE_HOUR_MS),
        provider: "google",
        refreshToken: "fresh-refresh",
      },
      {
        onCredentialCreated: () => {
          throw new Error("adoption must reuse the existing credential, not insert a new one");
        },
      },
    );

    await sweepOrphanedOAuthCredentials({
      database,
      minimumAgeMs: SAFETY_AGE_MS,
      now: () => new Date(),
    });

    expect(await remainingCredentialEmails()).toEqual([RECONNECTING_EMAIL]);
  });
});
