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
const BETTER_AUTH_1_7_SCHEMA_TAG = "0103_better_auth_1_7_schema";

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

interface AccountRow {
  accountId: string;
  id: string;
}

interface OAuthClientRow {
  applicationType: string | null;
  clientCredentialsScopes: string[];
  clientId: string;
}

const findSchemaIndexBeforeBetterAuth17 = async (): Promise<number> => {
  const journal = await Bun.file(`${DRIZZLE_DIRECTORY}/meta/_journal.json`)
    .json() as Journal;
  const entry = journal.entries.find(({ tag }) => tag === BETTER_AUTH_1_7_SCHEMA_TAG);
  if (!entry) {
    throw new Error(`Migration ${BETTER_AUTH_1_7_SCHEMA_TAG} is missing`);
  }
  return entry.idx - 1;
};

const encodeSegment = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const buildIdToken = (claims: Record<string, unknown>): string =>
  `${encodeSegment({ alg: "RS256", typ: "JWT" })}.${encodeSegment(claims)}.signature`;

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

const seedAccounts = async (client: Client): Promise<void> => {
  await client.query(`
    INSERT INTO "user" ("id", "name", "email", "emailVerified")
    VALUES
      ('signed-in-customer', 'Signed In Customer', 'signed-in@keeper.test', true),
      ('tokenless-customer', 'Tokenless Customer', 'tokenless@keeper.test', true),
      ('garbled-customer', 'Garbled Customer', 'garbled@keeper.test', true),
      ('google-customer', 'Google Customer', 'google@keeper.test', true)
  `);
  await client.query(
    `
      INSERT INTO "account" ("id", "userId", "accountId", "providerId", "idToken")
      VALUES
        ('signed-in-account', 'signed-in-customer', 'pairwise-subject', 'microsoft', $1),
        ('tokenless-account', 'tokenless-customer', 'tokenless-subject', 'microsoft', NULL),
        ('garbled-account', 'garbled-customer', 'garbled-subject', 'microsoft', 'not-a-token'),
        ('google-account', 'google-customer', 'google-subject', 'google', $2)
    `,
    [
      buildIdToken({ oid: "directory-object-id", sub: "pairwise-subject" }),
      buildIdToken({ oid: "google-has-no-object-id", sub: "google-subject" }),
    ],
  );
};

const seedOAuthClients = async (client: Client): Promise<void> => {
  await client.query(`
    INSERT INTO "oauth_application" ("id", "clientId", "redirectUris", "type", "public")
    VALUES
      ('web-client', 'web-client', ARRAY['https://web.example/callback'], 'web', false),
      ('native-client', 'native-client', ARRAY['http://localhost:4000/callback'], 'native', true),
      ('browser-client', 'browser-client', ARRAY['https://spa.example/callback'], 'user-agent-based', true)
  `);
};

const readAccounts = async (client: Client): Promise<AccountRow[]> => {
  const accounts = await client.query<AccountRow>(`
    SELECT "id", "accountId" FROM "account" ORDER BY "id"
  `);
  return accounts.rows;
};

const readOAuthClients = async (client: Client): Promise<OAuthClientRow[]> => {
  const clients = await client.query<OAuthClientRow>(`
    SELECT "clientId", "applicationType", "clientCredentialsScopes"
    FROM "oauth_application" ORDER BY "clientId"
  `);
  return clients.rows;
};

describe("upgrading to Better Auth 1.7", () => {
  it("keys a Microsoft account by the directory object id from its stored id token", async () => {
    const databaseUrl = await createDatabase("keeper_microsoft_object_id_backfill");
    await applyReleasedSchemaState(databaseUrl, await findSchemaIndexBeforeBetterAuth17());
    await withConnection(databaseUrl, seedAccounts);

    await runMigrationRunner(databaseUrl);

    await withConnection(databaseUrl, async (client) => {
      expect(await readAccounts(client)).toEqual([
        { accountId: "garbled-subject", id: "garbled-account" },
        { accountId: "google-subject", id: "google-account" },
        { accountId: "directory-object-id", id: "signed-in-account" },
        { accountId: "tokenless-subject", id: "tokenless-account" },
      ]);
    });
  });

  it("carries each OAuth client's type over as its application type", async () => {
    const databaseUrl = await createDatabase("keeper_oauth_client_application_type");
    await applyReleasedSchemaState(databaseUrl, await findSchemaIndexBeforeBetterAuth17());
    await withConnection(databaseUrl, seedOAuthClients);

    await runMigrationRunner(databaseUrl);

    await withConnection(databaseUrl, async (client) => {
      expect(await readOAuthClients(client)).toEqual([
        { applicationType: null, clientCredentialsScopes: [], clientId: "browser-client" },
        { applicationType: "native", clientCredentialsScopes: [], clientId: "native-client" },
        { applicationType: "web", clientCredentialsScopes: [], clientId: "web-client" },
      ]);
    });
  });
});
