import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { reconcileProviderAccountIdentity } from "../../src/database/provider-account-identity";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const migrationScript = `${import.meta.dirname}/../../scripts/migrate.ts`;
const scratchName = `keeper_census_merge_${process.pid}`;

const USER_ID = "census-merge-customer";
const PROVIDER = "google";
const PROVIDER_ACCOUNT_ID = "G-123";
const DEAD_CREDENTIAL_ID = "11111111-1111-1111-1111-111111111111";
const FRESH_CREDENTIAL_ID = "22222222-2222-2222-2222-222222222222";
const IDENTITY_ROW_ID = "33333333-3333-3333-3333-333333333333";
const RECONNECTED_ROW_ID = "44444444-4444-4444-4444-444444444444";

const scratchUrl = (): string => {
  const url = new URL(administrativeUrl ?? "postgres://localhost");
  url.pathname = `/${scratchName}`;
  return url.toString();
};

const withAdministrativeClient = async <Result>(
  run: (client: Client) => Promise<Result>,
): Promise<Result> => {
  const client = new Client({ connectionString: administrativeUrl });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
};

const withScratchClient = async <Result>(
  run: (client: Client) => Promise<Result>,
): Promise<Result> => {
  const client = new Client({ connectionString: scratchUrl() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
};

const runMigrations = async (): Promise<void> => {
  const result = await Bun.$`bun ${migrationScript}`
    .env({ ...process.env, DATABASE_URL: scratchUrl() })
    .quiet()
    .nothrow();
  if (result.exitCode !== 0) {
    throw new Error(
      `Migration failed for ${scratchName}: ${result.stdout.toString()}${result.stderr.toString()}`,
    );
  }
};

const seedReconnectedPair = async (client: Client): Promise<void> => {
  await client.query(
    `INSERT INTO "user" ("id", "email", "name") VALUES ($1, $2, 'Census Merge Fixture')`,
    [USER_ID, `${USER_ID}@example.com`],
  );
  await client.query(
    `INSERT INTO "oauth_credentials"
       ("id", "accessToken", "createdAt", "email", "expiresAt", "needsReauthentication", "provider", "refreshToken", "userId")
     VALUES ($1, 'dead-access', now() - interval '30 days', 'old-address@example.com', now() - interval '1 hour', true, $2, 'DEAD-REFRESH', $3)`,
    [DEAD_CREDENTIAL_ID, PROVIDER, USER_ID],
  );
  await client.query(
    `INSERT INTO "oauth_credentials"
       ("id", "accessToken", "createdAt", "email", "expiresAt", "needsReauthentication", "provider", "refreshToken", "userId")
     VALUES ($1, 'fresh-access', now() - interval '5 minutes', 'new-address@example.com', now() + interval '1 hour', false, $2, 'FRESH-REFRESH', $3)`,
    [FRESH_CREDENTIAL_ID, PROVIDER, USER_ID],
  );
  await client.query(
    `INSERT INTO "calendar_accounts" ("id", "accountId", "authType", "email", "oauthCredentialId", "provider", "userId")
     VALUES ($1, $2, 'oauth', 'old-address@example.com', $3, $4, $5)`,
    [IDENTITY_ROW_ID, PROVIDER_ACCOUNT_ID, DEAD_CREDENTIAL_ID, PROVIDER, USER_ID],
  );
  await client.query(
    `INSERT INTO "calendar_accounts" ("id", "accountId", "authType", "email", "oauthCredentialId", "provider", "userId")
     VALUES ($1, null, 'oauth', 'new-address@example.com', $2, $3, $4)`,
    [RECONNECTED_ROW_ID, FRESH_CREDENTIAL_ID, PROVIDER, USER_ID],
  );
};

const readSurvivingRefreshTokens = async (client: Client): Promise<string[]> => {
  const result = await client.query<{ refreshToken: string }>(
    `SELECT "refreshToken" FROM "oauth_credentials" WHERE "userId" = $1 ORDER BY "refreshToken"`,
    [USER_ID],
  );
  return result.rows.map((row) => row.refreshToken);
};

const readCalendarCredentialIds = async (
  client: Client,
): Promise<Record<string, string | null>> => {
  const result = await client.query<{ id: string; oauthCredentialId: string | null }>(
    `SELECT "id", "oauthCredentialId" FROM "calendar_accounts" WHERE "userId" = $1`,
    [USER_ID],
  );
  return Object.fromEntries(
    result.rows.map((row) => [row.id, row.oauthCredentialId]),
  );
};

describe.skipIf(!administrativeUrl)("census merge keeps the usable grant", () => {
  beforeAll(async () => {
    await withAdministrativeClient(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${scratchName}"`);
      await client.query(`CREATE DATABASE "${scratchName}"`);
    });
    await runMigrations();
  }, 300_000);

  afterAll(async () => {
    await withAdministrativeClient(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${scratchName}"`);
    });
  }, 120_000);

  it("merges onto the credential that still works, not the one that holds the identity", async () => {
    await withScratchClient(async (client) => {
      await seedReconnectedPair(client);

      const database = drizzle(client);
      const outcome = await reconcileProviderAccountIdentity({
        accountRowId: RECONNECTED_ROW_ID,
        adopt: () => {
          throw new Error(
            "The reconnected row's identity is already held by a sibling, so nothing may be adopted",
          );
        },
        database,
        providerAccountId: PROVIDER_ACCOUNT_ID,
      });

      expect(outcome).toBe("merged");
      expect(await readSurvivingRefreshTokens(client)).toEqual(["FRESH-REFRESH"]);
      expect(await readCalendarCredentialIds(client)).toEqual({
        [IDENTITY_ROW_ID]: FRESH_CREDENTIAL_ID,
        [RECONNECTED_ROW_ID]: FRESH_CREDENTIAL_ID,
      });
    });
  }, 120_000);
});
