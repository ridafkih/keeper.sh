import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const migrationScript = `${import.meta.dirname}/../../scripts/migrate.ts`;
const drizzleDirectory = `${import.meta.dirname}/../../drizzle`;
const templateName = `keeper_account_identity_template_${process.pid}`;
const scratchNames: string[] = [];

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

const withDatabaseClient = async <Result>(
  databaseName: string,
  run: (client: Client) => Promise<Result>,
): Promise<Result> => {
  const url = new URL(administrativeUrl ?? "postgres://localhost");
  url.pathname = `/${databaseName}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
};

const runMigrations = async (databaseName: string): Promise<void> => {
  const url = new URL(administrativeUrl ?? "postgres://localhost");
  url.pathname = `/${databaseName}`;
  const result = await Bun.$`bun ${migrationScript}`
    .env({ ...process.env, DATABASE_URL: url.toString() })
    .quiet()
    .nothrow();
  if (result.exitCode !== 0) {
    throw new Error(
      `Migration failed for ${databaseName}: ${result.stdout.toString()}${result.stderr.toString()}`,
    );
  }
};

const createScratchDatabase = async (label: string): Promise<string> => {
  const name = `keeper_account_identity_${label}_${process.pid}`;
  scratchNames.push(name);
  await withAdministrativeClient(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
    await client.query(`CREATE DATABASE "${name}" TEMPLATE "${templateName}"`);
  });
  return name;
};

const seedUser = async (client: Client, userId: string): Promise<void> => {
  await client.query(
    `INSERT INTO "user" ("id", "email", "name") VALUES ($1, $2, $3)`,
    [userId, `${userId}@example.com`, "Account Identity Fixture"],
  );
};

const insertAccount = async (
  client: Client,
  values: {
    userId: string;
    provider: string;
    accountId: string | null;
    email?: string | null;
  },
): Promise<string> => {
  const result = await client.query<{ id: string }>(
    `INSERT INTO "calendar_accounts" ("authType", "provider", "userId", "accountId", "email")
     VALUES ('oauth', $1, $2, $3, $4) RETURNING "id"`,
    [values.provider, values.userId, values.accountId, values.email ?? null],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("Failed to seed a calendar account");
  }
  return id;
};

const readDuplicateProviderIdentities = async (
  client: Client,
): Promise<{ count: number }[]> => {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM "calendar_accounts"
     WHERE "accountId" IS NOT NULL
     GROUP BY "userId", "provider", "accountId"
     HAVING count(*) > 1`,
  );
  return result.rows.map((row) => ({ count: Number(row.count) }));
};

const readMigrationStatements = async (tag: string): Promise<string[]> => {
  const contents = await Bun.file(`${drizzleDirectory}/${tag}.sql`).text();
  return contents
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
};

describe.skipIf(!administrativeUrl)("calendar account provider identity", () => {
  beforeAll(async () => {
    await withAdministrativeClient(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${templateName}"`);
      await client.query(`CREATE DATABASE "${templateName}"`);
    });
    await runMigrations(templateName);
  }, 300_000);

  afterAll(async () => {
    await withAdministrativeClient(async (client) => {
      for (const name of [...scratchNames, templateName]) {
        await client.query(`DROP DATABASE IF EXISTS "${name}"`);
      }
    });
  }, 120_000);

  it("lets two users hold the same provider account", async () => {
    const databaseName = await createScratchDatabase("cross_user");
    await withDatabaseClient(databaseName, async (client) => {
      await seedUser(client, "identity-user-a");
      await seedUser(client, "identity-user-b");
      await insertAccount(client, {
        accountId: "shared-provider-account",
        provider: "google",
        userId: "identity-user-a",
      });

      await expect(insertAccount(client, {
        accountId: "shared-provider-account",
        provider: "google",
        userId: "identity-user-b",
      })).resolves.toEqual(expect.any(String));
    });
  }, 120_000);

  it("still refuses a second row for one user's provider account", async () => {
    const databaseName = await createScratchDatabase("same_user");
    await withDatabaseClient(databaseName, async (client) => {
      await seedUser(client, "identity-user-c");
      await insertAccount(client, {
        accountId: "one-provider-account",
        provider: "google",
        userId: "identity-user-c",
      });

      await expect(insertAccount(client, {
        accountId: "one-provider-account",
        provider: "google",
        userId: "identity-user-c",
      })).rejects.toThrow();
    });
  }, 120_000);

  it("keeps unlinked accounts free to coexist while their id is unknown", async () => {
    const databaseName = await createScratchDatabase("null_ids");
    await withDatabaseClient(databaseName, async (client) => {
      await seedUser(client, "identity-user-d");
      await insertAccount(client, {
        accountId: null,
        provider: "google",
        userId: "identity-user-d",
      });

      await expect(insertAccount(client, {
        accountId: null,
        provider: "google",
        userId: "identity-user-d",
      })).resolves.toEqual(expect.any(String));
    });
  }, 120_000);

  it("replays 0085 over a sibling pair without aborting or duplicating an identity", async () => {
    const databaseName = await createScratchDatabase("sibling_backfill");
    const statements = await readMigrationStatements("0085_fixed_kat_farrell");

    await withDatabaseClient(databaseName, async (client) => {
      await seedUser(client, "identity-user-e");
      await insertAccount(client, {
        accountId: "donor-provider-account",
        email: "person@example.com",
        provider: "google",
        userId: "identity-user-e",
      });
      await insertAccount(client, {
        accountId: null,
        email: "person@example.com",
        provider: "google",
        userId: "identity-user-e",
      });

      for (const statement of statements) {
        await client.query(statement);
      }

      expect(await readDuplicateProviderIdentities(client)).toEqual([]);
    });
  }, 120_000);
});
