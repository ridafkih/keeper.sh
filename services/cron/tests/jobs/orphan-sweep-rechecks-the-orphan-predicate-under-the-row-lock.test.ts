import type { PGlite } from "@electric-sql/pglite";
import { PGlite as PGliteClient } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { sweepOrphanedOAuthCredentials } from "../../src/jobs/reap-teardown-residue";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const SAFETY_AGE_MS = 60 * 60 * 1000;
const CONNECTING_EMAIL = "connecting@workspace.example";

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

interface QueryResult<Row> {
  rows: Row[];
}

interface PgliteExecutor {
  query: <Row>(
    query: string,
    params?: unknown[],
    options?: unknown,
  ) => Promise<QueryResult<Row>>;
  transaction?: <Result>(
    callback: (executor: PgliteExecutor) => Promise<Result>,
  ) => Promise<Result>;
}

interface ConnectingSession {
  committed: boolean;
  credentialId: string;
  credentialSurvivedTheLockWait: boolean;
}

const commitConnectingCalendarAccount = async (
  executor: PgliteExecutor,
  session: ConnectingSession,
) => {
  const parent = await executor.query<{ id: string }>(
    `select "id" from oauth_credentials where "id" = $1`,
    [session.credentialId],
  );

  session.credentialSurvivedTheLockWait = parent.rows.length > 0;

  if (!session.credentialSurvivedTheLockWait) {
    return;
  }

  await executor.query(
    `insert into calendar_accounts ("accountId", "email", "oauthCredentialId", "provider", "userId")
     values ('connecting-account', $1, $2, 'google', 'user-a')`,
    [CONNECTING_EMAIL, session.credentialId],
  );
};

const withLockWaitOrdering = (
  executor: PgliteExecutor,
  session: ConnectingSession,
): PgliteExecutor => ({
  query: async <Row,>(query: string, params?: unknown[], options?: unknown) => {
    const result = await executor.query<Row>(query, params, options);

    if (!session.committed && query.includes("oauth_credentials")) {
      session.committed = true;
      await commitConnectingCalendarAccount(executor, session);
    }

    return result;
  },
  transaction: async <Result,>(callback: (inner: PgliteExecutor) => Promise<Result>) => {
    if (!executor.transaction) {
      throw new Error("the sweep asked for a transaction the lock-wait executor cannot open");
    }

    return await executor.transaction<Result>((inner) =>
      callback(withLockWaitOrdering(inner, session)),
    );
  },
});

describe("orphan sweep rechecks the orphan predicate under the row lock (database double simulating the lock-wait ordering)", () => {
  const client = new PGliteClient();

  beforeEach(async () => {
    await client.exec(`drop table if exists calendar_accounts, oauth_credentials, "user" cascade;`);
    await client.exec(DDL);
    await client.query(
      `insert into "user" ("email", "id", "name") values ('user-a@keeper.sh', 'user-a', 'User A')`,
    );
  });

  it("leaves a credential that gained a calendar account while the sweep waited for its row lock", async () => {
    const seeded = await client.query<{ id: string }>(
      `insert into oauth_credentials ("accessToken", "createdAt", "email", "expiresAt", "provider", "refreshToken", "userId")
       values ('access', timestamptz '2026-08-24T12:00:00.000Z', $1, timestamptz '2026-08-26T13:00:00.000Z', 'google', 'refresh', 'user-a')
       returning "id"`,
      [CONNECTING_EMAIL],
    );

    const [credential] = seeded.rows;

    if (!credential) {
      throw new Error("seeding the credential the connect path is attaching to returned no row");
    }

    const session: ConnectingSession = {
      committed: false,
      credentialId: credential.id,
      credentialSurvivedTheLockWait: false,
    };

    const database = drizzle({
      client: withLockWaitOrdering(client as unknown as PgliteExecutor, session) as unknown as PGlite,
    });

    await sweepOrphanedOAuthCredentials({
      database,
      minimumAgeMs: SAFETY_AGE_MS,
      now: () => NOW,
    });

    expect(session.committed).toBe(true);
    expect(session.credentialSurvivedTheLockWait).toBe(true);

    const survivingCredentials = await client.query<{ id: string }>(
      `select "id" from oauth_credentials where "id" = $1`,
      [credential.id],
    );
    const survivingCalendarAccounts = await client.query<{ email: string }>(
      `select "email" from calendar_accounts where "oauthCredentialId" = $1`,
      [credential.id],
    );

    expect(survivingCredentials.rows).toHaveLength(1);
    expect(survivingCalendarAccounts.rows.map((row) => row.email)).toEqual([CONNECTING_EMAIL]);
  });

  it("still deletes a credential that stays orphaned through the whole sweep", async () => {
    const seeded = await client.query<{ id: string }>(
      `insert into oauth_credentials ("accessToken", "createdAt", "email", "expiresAt", "provider", "refreshToken", "userId")
       values ('access', timestamptz '2026-08-24T12:00:00.000Z', 'stale-orphan@workspace.example', timestamptz '2026-08-26T13:00:00.000Z', 'google', 'refresh', 'user-a')
       returning "id"`,
    );

    const [credential] = seeded.rows;

    if (!credential) {
      throw new Error("seeding the orphaned credential returned no row");
    }

    const database = drizzle({ client });

    const swept = await sweepOrphanedOAuthCredentials({
      database,
      minimumAgeMs: SAFETY_AGE_MS,
      now: () => NOW,
    });

    const remaining = await client.query<{ id: string }>(
      `select "id" from oauth_credentials where "id" = $1`,
      [credential.id],
    );

    expect(swept).toBe(1);
    expect(remaining.rows).toHaveLength(0);
  });
});
