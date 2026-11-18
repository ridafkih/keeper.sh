import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

const ADMIN_DATABASE_URL = Bun.env.MIGRATION_TEST_DATABASE_URL;

if (!ADMIN_DATABASE_URL) {
  throw new Error("MIGRATION_TEST_DATABASE_URL is missing");
}

const PACKAGE_ROOT = `${import.meta.dirname}/../..`;
const DRIZZLE_DIRECTORY = `${PACKAGE_ROOT}/drizzle`;
const CLEANUP_TAG = "0117_sign_in_tokens_are_not_kept";

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

interface AccountRow {
  accessToken: string | null;
  accessTokenExpiresAt: Date | null;
  accountId: string;
  id: string;
  idToken: string | null;
  password: string | null;
  providerId: string;
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
  scope: string | null;
}

const findCleanupEntry = async (): Promise<JournalEntry> => {
  const journal = await Bun.file(`${DRIZZLE_DIRECTORY}/meta/_journal.json`)
    .json() as Journal;
  const entry = journal.entries.find(({ tag }) => tag === CLEANUP_TAG);
  if (!entry) {
    throw new Error(`Migration ${CLEANUP_TAG} is missing from the journal`);
  }
  return entry;
};

const createDatabase = async (name: string): Promise<string> => {
  const admin = new Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const databaseUrl = new URL(ADMIN_DATABASE_URL);
  databaseUrl.pathname = `/${name}`;
  return databaseUrl.toString();
};

const applyReleasedSchemaState = async (
  databaseUrl: string,
  throughIndex: number,
): Promise<void> => {
  const journal = await Bun.file(`${DRIZZLE_DIRECTORY}/meta/_journal.json`)
    .json() as Journal;
  const entries = journal.entries.filter(({ idx }) => idx <= throughIndex);
  if (entries.length === 0) {
    throw new Error(`No migrations found at or below ${throughIndex}`);
  }
  const folder = await mkdtemp(join(tmpdir(), "keeper-released-schema-"));
  await mkdir(join(folder, "meta"));
  await writeFile(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }),
  );
  for (const entry of entries) {
    await copyFile(
      `${DRIZZLE_DIRECTORY}/${entry.tag}.sql`,
      join(folder, `${entry.tag}.sql`),
    );
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally {
    await client.end();
    await rm(folder, { force: true, recursive: true });
  }
};

const runMigrationRunner = async (databaseUrl: string): Promise<void> => {
  const runner = Bun.spawn(["bun", "scripts/migrate.ts"], {
    cwd: PACKAGE_ROOT,
    env: { ...Bun.env, DATABASE_URL: databaseUrl },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, failure] = await Promise.all([
    runner.exited,
    new Response(runner.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Migration runner exited ${exitCode}: ${failure}`);
  }
};

const withConnection = async <Result>(
  databaseUrl: string,
  use: (client: Client) => Promise<Result>,
): Promise<Result> => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
};

const TOKEN_COLUMNS = [
  "accessToken",
  "accessTokenExpiresAt",
  "idToken",
  "refreshToken",
  "refreshTokenExpiresAt",
] as const;

const seedAccounts = async (client: Client): Promise<void> => {
  await client.query(`
    INSERT INTO "user" ("id", "email", "name") VALUES
      ('owner', 'owner@keeper.test', 'Owner'),
      ('other', 'other@keeper.test', 'Other')
  `);
  await client.query(`
    INSERT INTO "account" (
      "id", "accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken",
      "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "password"
    ) VALUES
      ('google-full', 'google-subject', 'google', 'owner', 'plain-google-access', 'plain-google-refresh', 'plain.google.id-token', now() + interval '1 hour', now() + interval '30 days', 'openid,email,profile', NULL),
      ('microsoft-partial', 'microsoft-object', 'microsoft', 'owner', 'plain-microsoft-access', NULL, 'plain.microsoft.id-token', now() - interval '1 day', NULL, 'openid,profile,email,User.Read,offline_access', NULL),
      ('oidc-id-token-only', 'oidc-subject', 'oidc', 'other', NULL, NULL, 'plain.oidc.id-token', NULL, NULL, 'openid,profile,email', NULL),
      ('password-only', 'other', 'credential', 'other', NULL, NULL, NULL, NULL, NULL, NULL, 'stored-password-hash')
  `);
};

const readAccounts = async (client: Client): Promise<AccountRow[]> => {
  const accounts = await client.query<AccountRow>(`
    SELECT "id", "accountId", "providerId", "accessToken", "refreshToken", "idToken",
      "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "password"
    FROM "account" ORDER BY "id"
  `);
  return accounts.rows;
};

const expectNoTokens = (accounts: AccountRow[]): void => {
  for (const account of accounts) {
    for (const column of TOKEN_COLUMNS) {
      expect({ column, id: account.id, value: account[column] })
        .toEqual({ column, id: account.id, value: null });
    }
  }
  expect(JSON.stringify(accounts)).not.toContain("plain");
};

describe("stored sign-in tokens", () => {
  it("are removed from every account while the rest of each row is kept", async () => {
    const cleanup = await findCleanupEntry();
    const databaseUrl = await createDatabase("keeper_sign_in_tokens_removed");
    await applyReleasedSchemaState(databaseUrl, cleanup.idx - 1);
    await withConnection(databaseUrl, seedAccounts);

    await runMigrationRunner(databaseUrl);

    await withConnection(databaseUrl, async (client) => {
      const accounts = await readAccounts(client);
      expectNoTokens(accounts);
      expect(accounts.map(({ accountId, id, password, providerId, scope }) => ({
        accountId,
        id,
        password,
        providerId,
        scope,
      }))).toEqual([
        { accountId: "google-subject", id: "google-full", password: null, providerId: "google", scope: "openid,email,profile" },
        { accountId: "microsoft-object", id: "microsoft-partial", password: null, providerId: "microsoft", scope: "openid,profile,email,User.Read,offline_access" },
        { accountId: "oidc-subject", id: "oidc-id-token-only", password: null, providerId: "oidc", scope: "openid,profile,email" },
        { accountId: "other", id: "password-only", password: "stored-password-hash", providerId: "credential", scope: null },
      ]);
    });
  });

  it("are discarded when a release that still sends them writes to the table afterwards", async () => {
    const cleanup = await findCleanupEntry();
    const databaseUrl = await createDatabase("keeper_sign_in_tokens_discarded");
    await applyReleasedSchemaState(databaseUrl, cleanup.idx - 1);
    await withConnection(databaseUrl, seedAccounts);
    await runMigrationRunner(databaseUrl);

    await withConnection(databaseUrl, async (client) => {
      await client.query(`
        UPDATE "account"
        SET "accessToken" = 'plain-later-access', "refreshToken" = 'plain-later-refresh',
          "idToken" = 'plain.later.id-token', "accessTokenExpiresAt" = now(),
          "refreshTokenExpiresAt" = now(), "scope" = 'openid,email'
        WHERE "id" = 'google-full'
      `);
      await client.query(`
        INSERT INTO "account" (
          "id", "accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken",
          "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope"
        ) VALUES (
          'google-later', 'google-later-subject', 'google', 'other', 'plain-new-access',
          'plain-new-refresh', 'plain.new.id-token', now(), now(), 'openid'
        )
      `);
      await client.query(`
        UPDATE "account" SET "password" = 'changed-password-hash' WHERE "id" = 'password-only'
      `);

      const accounts = await readAccounts(client);
      expectNoTokens(accounts);
      expect(accounts.find(({ id }) => id === "google-full")?.scope).toBe("openid,email");
      expect(accounts.find(({ id }) => id === "google-later")?.scope).toBe("openid");
      expect(accounts.find(({ id }) => id === "password-only")?.password)
        .toBe("changed-password-hash");
    });
  });

  it("stay removed when the migration runner starts again", async () => {
    const cleanup = await findCleanupEntry();
    const databaseUrl = await createDatabase("keeper_sign_in_tokens_rerun");
    await applyReleasedSchemaState(databaseUrl, cleanup.idx - 1);
    await withConnection(databaseUrl, seedAccounts);
    await runMigrationRunner(databaseUrl);
    const afterFirst = await withConnection(databaseUrl, readAccounts);

    await runMigrationRunner(databaseUrl);

    expect(await withConnection(databaseUrl, readAccounts)).toEqual(afterFirst);
  });
});
