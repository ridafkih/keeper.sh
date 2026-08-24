import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const ADMIN_DATABASE_URL = Bun.env.MIGRATION_TEST_DATABASE_URL;

if (!ADMIN_DATABASE_URL) {
  throw new Error("MIGRATION_TEST_DATABASE_URL is missing");
}

const PACKAGE_ROOT = `${import.meta.dirname}/../..`;

const IDENTITY_CHECK = "event_mappings_identity_check";

const createScratchDatabase = async (): Promise<string> => {
  const name = `keeper_validate_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const databaseUrl = new URL(ADMIN_DATABASE_URL);
  databaseUrl.pathname = `/${name}`;
  return databaseUrl.toString();
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

const constraintIsValidated = async (
  connection: Client,
  constraint: string,
): Promise<boolean> => {
  const state = await connection.query<{ validated: boolean }>(`
    SELECT convalidated AS validated
    FROM pg_constraint
    WHERE conname = '${constraint}'
  `);
  return state.rows[0]?.validated === true;
};

/*
 * A run that dies between adding a NOT VALID constraint and validating it leaves the
 * constraint unenforced for the rows already in the table. Recovery depends entirely on the
 * readiness gate counting an unvalidated constraint as not-ready, so that the next run
 * re-enters the post-migration block and finishes the job.
 */
describe("constraints left NOT VALID by an interrupted run", () => {
  let databaseUrl = "";
  let connection: Client | null = null;

  const connected = (): Client => {
    if (!connection) {
      throw new Error("Scratch database client is not connected");
    }
    return connection;
  };

  beforeAll(async () => {
    databaseUrl = await createScratchDatabase();
    await runMigrationRunner(databaseUrl);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    connection = client;
  }, 120_000);

  afterAll(async () => {
    await connected().end();
    const admin = new Client({ connectionString: ADMIN_DATABASE_URL });
    await admin.connect();
    try {
      const name = new URL(databaseUrl).pathname.slice(1);
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });

  it("leave the runtime not-ready, so the next run validates them", async () => {
    await connected().query(`
      ALTER TABLE "event_mappings"
        DROP CONSTRAINT "${IDENTITY_CHECK}",
        ADD CONSTRAINT "${IDENTITY_CHECK}"
          CHECK ("eventStateId" IS NOT NULL OR "syncEventId" IS NOT NULL)
          NOT VALID
    `);
    expect(await constraintIsValidated(connected(), IDENTITY_CHECK)).toBe(false);

    await runMigrationRunner(databaseUrl);

    expect(await constraintIsValidated(connected(), IDENTITY_CHECK)).toBe(true);
  }, 120_000);
});
