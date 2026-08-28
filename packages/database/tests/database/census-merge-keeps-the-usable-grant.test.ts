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

const CONTENDED_USER_ID = "census-merge-contended-customer";
const CONTENDED_PROVIDER_ACCOUNT_ID = "G-456";
const CONTENDED_DEAD_CREDENTIAL_ID = "55555555-5555-5555-5555-555555555555";
const CONTENDED_FRESH_CREDENTIAL_ID = "66666666-6666-6666-6666-666666666666";
const CONTENDED_IDENTITY_ROW_ID = "77777777-7777-7777-7777-777777777777";
const CONTENDED_RECONNECTED_ROW_ID = "88888888-8888-8888-8888-888888888888";
const CONNECTING_ROW_ID = "99999999-9999-9999-9999-999999999999";
const CONNECTING_CALENDAR_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LOCK_WAIT_POLL_MS = 25;
const LOCK_WAIT_BUDGET_MS = 30_000;

const openScratchClient = async (): Promise<Client> => {
  const client = new Client({ connectionString: scratchUrl() });
  await client.connect();
  return client;
};

const seedContendedPair = async (client: Client): Promise<void> => {
  await client.query(
    `INSERT INTO "user" ("id", "email", "name") VALUES ($1, $2, 'Census Merge Contention Fixture')`,
    [CONTENDED_USER_ID, `${CONTENDED_USER_ID}@example.com`],
  );
  await client.query(
    `INSERT INTO "oauth_credentials"
       ("id", "accessToken", "createdAt", "email", "expiresAt", "needsReauthentication", "provider", "refreshToken", "userId")
     VALUES ($1, 'dead-access', now() - interval '30 days', 'old-address@example.com', now() - interval '1 hour', true, $2, 'CONTENDED-DEAD-REFRESH', $3)`,
    [CONTENDED_DEAD_CREDENTIAL_ID, PROVIDER, CONTENDED_USER_ID],
  );
  await client.query(
    `INSERT INTO "oauth_credentials"
       ("id", "accessToken", "createdAt", "email", "expiresAt", "needsReauthentication", "provider", "refreshToken", "userId")
     VALUES ($1, 'fresh-access', now() - interval '5 minutes', 'new-address@example.com', now() + interval '1 hour', false, $2, 'CONTENDED-FRESH-REFRESH', $3)`,
    [CONTENDED_FRESH_CREDENTIAL_ID, PROVIDER, CONTENDED_USER_ID],
  );
  await client.query(
    `INSERT INTO "calendar_accounts" ("id", "accountId", "authType", "email", "oauthCredentialId", "provider", "userId")
     VALUES ($1, $2, 'oauth', 'old-address@example.com', $3, $4, $5)`,
    [
      CONTENDED_IDENTITY_ROW_ID,
      CONTENDED_PROVIDER_ACCOUNT_ID,
      CONTENDED_DEAD_CREDENTIAL_ID,
      PROVIDER,
      CONTENDED_USER_ID,
    ],
  );
  await client.query(
    `INSERT INTO "calendar_accounts" ("id", "accountId", "authType", "email", "oauthCredentialId", "provider", "userId")
     VALUES ($1, null, 'oauth', 'new-address@example.com', $2, $3, $4)`,
    [
      CONTENDED_RECONNECTED_ROW_ID,
      CONTENDED_FRESH_CREDENTIAL_ID,
      PROVIDER,
      CONTENDED_USER_ID,
    ],
  );
};

const openConnectTransactionAgainstTheLoser = async (
  client: Client,
): Promise<void> => {
  await client.query("BEGIN");
  await client.query(
    `INSERT INTO "calendar_accounts" ("id", "accountId", "authType", "email", "oauthCredentialId", "provider", "userId")
     VALUES ($1, null, 'oauth', 'old-address@example.com', $2, $3, $4)`,
    [
      CONNECTING_ROW_ID,
      CONTENDED_DEAD_CREDENTIAL_ID,
      PROVIDER,
      CONTENDED_USER_ID,
    ],
  );
  await client.query(
    `INSERT INTO "calendars" ("id", "accountId", "calendarType", "name", "userId")
     VALUES ($1, $2, 'primary', 'Contended Primary', $3)`,
    [CONNECTING_CALENDAR_ID, CONNECTING_ROW_ID, CONTENDED_USER_ID],
  );
};

const waitUntilTheMergeBlocksOnALock = async (observer: Client): Promise<void> => {
  const deadline = Date.now() + LOCK_WAIT_BUDGET_MS;
  while (Date.now() < deadline) {
    const waiting = await observer.query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM pg_stat_activity
        WHERE datname = $1 AND state = 'active' AND wait_event_type = 'Lock'`,
      [scratchName],
    );
    if (Number(waiting.rows[0]?.total ?? "0") > 0) {
      return;
    }
    await Bun.sleep(LOCK_WAIT_POLL_MS);
  }
  throw new Error(
    "The merge never blocked on the losing credential, so the interleaving this test needs never happened",
  );
};

const readConnectSurvival = async (
  client: Client,
): Promise<{ calendarAccounts: number; calendars: number }> => {
  const accounts = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM "calendar_accounts" WHERE "id" = $1`,
    [CONNECTING_ROW_ID],
  );
  const calendars = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM "calendars" WHERE "id" = $1`,
    [CONNECTING_CALENDAR_ID],
  );
  return {
    calendarAccounts: Number(accounts.rows[0]?.total ?? "0"),
    calendars: Number(calendars.rows[0]?.total ?? "0"),
  };
};

const settle = async <Result>(
  work: Promise<Result>,
): Promise<{ failure: Error | null }> => {
  try {
    await work;
    return { failure: null };
  } catch (error) {
    return { failure: error instanceof Error ? error : new Error(String(error)) };
  }
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

  it("locks the losing credential before repointing, so a concurrent connect never loses its calendar account", async () => {
    const seedClient = await openScratchClient();
    const connectClient = await openScratchClient();
    const mergeClient = await openScratchClient();
    const observerClient = await openScratchClient();

    try {
      await seedContendedPair(seedClient);
      await openConnectTransactionAgainstTheLoser(connectClient);

      const merge = reconcileProviderAccountIdentity({
        accountRowId: CONTENDED_RECONNECTED_ROW_ID,
        adopt: () => {
          throw new Error(
            "The reconnected row's identity is already held by a sibling, so nothing may be adopted",
          );
        },
        database: drizzle(mergeClient),
        providerAccountId: CONTENDED_PROVIDER_ACCOUNT_ID,
      });
      const mergeSettlement = settle(merge);

      await waitUntilTheMergeBlocksOnALock(observerClient);

      const connectSettlement = await settle(connectClient.query("COMMIT"));
      await mergeSettlement;

      const survival = await readConnectSurvival(observerClient);

      if (connectSettlement.failure) {
        expect(connectSettlement.failure.message).toContain("foreign key");
        expect(survival).toEqual({ calendarAccounts: 0, calendars: 0 });
        return;
      }

      expect(survival).toEqual({ calendarAccounts: 1, calendars: 1 });
    } finally {
      await seedClient.end();
      await connectClient.end();
      await mergeClient.end();
      await observerClient.end();
    }
  }, 120_000);
});
