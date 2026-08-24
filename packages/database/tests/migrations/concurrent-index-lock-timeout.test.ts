import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  BLOCKING_LOCK_TIMEOUT,
  withoutLockTimeout,
} from "../../src/database/concurrent-index";

const ADMIN_DATABASE_URL = Bun.env.MIGRATION_TEST_DATABASE_URL;

if (!ADMIN_DATABASE_URL) {
  throw new Error("MIGRATION_TEST_DATABASE_URL is missing");
}

const LOCK_TIMEOUT_UNDER_TEST = "300ms";
const LOCK_NOT_AVAILABLE = "55P03";

const createScratchDatabase = async (): Promise<string> => {
  const name = `keeper_cic_${randomUUID().replaceAll("-", "")}`;
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

const indexIsValid = async (connection: Client): Promise<boolean> => {
  const state = await connection.query<{ valid: boolean }>(`
    SELECT index_state.indisvalid AS valid
    FROM pg_class index_class
    INNER JOIN pg_index index_state ON index_state.indexrelid = index_class.oid
    WHERE index_class.relname = 'mappings_source_idx'
  `);
  return state.rows[0]?.valid === true;
};

const currentLockTimeout = async (connection: Client): Promise<string> => {
  const state = await connection.query<{ lock_timeout: string }>("SHOW lock_timeout");
  return state.rows[0]?.lock_timeout ?? "";
};

const buildIndexConcurrently = (connection: Client): Promise<unknown> =>
  connection.query(`
    CREATE INDEX CONCURRENTLY "mappings_source_idx" ON "mappings" ("sourceId")
  `);

describe("concurrent index builds under a session lock timeout", () => {
  let databaseUrl = "";
  let clients: { blocker: Client; migrator: Client } | null = null;

  const connected = (): { blocker: Client; migrator: Client } => {
    if (!clients) {
      throw new Error("Scratch database clients are not connected");
    }
    return clients;
  };

  beforeAll(async () => {
    databaseUrl = await createScratchDatabase();
    const migrator = new Client({ connectionString: databaseUrl });
    const blocker = new Client({ connectionString: databaseUrl });
    await migrator.connect();
    await blocker.connect();
    await migrator.query(`CREATE TABLE "mappings" ("sourceId" text NOT NULL)`);
    clients = { blocker, migrator };
  });

  afterAll(async () => {
    await connected().blocker.end();
    await connected().migrator.end();
    const admin = new Client({ connectionString: ADMIN_DATABASE_URL });
    await admin.connect();
    try {
      const name = new URL(databaseUrl).pathname.slice(1);
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });

  beforeEach(async () => {
    await connected().migrator.query(`DROP INDEX IF EXISTS "mappings_source_idx"`);
  });

  it("is cancelled by the session lock timeout, leaving the index invalid", async () => {
    await connected().migrator.query(`SET lock_timeout = '${LOCK_TIMEOUT_UNDER_TEST}'`);
    await connected().blocker.query("BEGIN");
    await connected().blocker.query(`LOCK TABLE "mappings" IN ACCESS EXCLUSIVE MODE`);

    const rejection = await buildIndexConcurrently(connected().migrator).then(
      () => null,
      (error: unknown) => error,
    );
    await connected().blocker.query("ROLLBACK");

    expect(rejection).toMatchObject({ code: LOCK_NOT_AVAILABLE });
    expect(await indexIsValid(connected().migrator)).toBe(false);
  });

  it("clears the lock timeout for the duration of the build, then restores it", async () => {
    await connected().migrator.query(`SET lock_timeout = '${LOCK_TIMEOUT_UNDER_TEST}'`);

    let timeoutDuringBuild = "";
    await withoutLockTimeout(connected().migrator, async () => {
      timeoutDuringBuild = await currentLockTimeout(connected().migrator);
      await buildIndexConcurrently(connected().migrator);
    });

    expect(timeoutDuringBuild).toBe("0");
    expect(await indexIsValid(connected().migrator)).toBe(true);
    expect(await currentLockTimeout(connected().migrator)).toBe(BLOCKING_LOCK_TIMEOUT);
  });

  it("restores the lock timeout when the build itself fails", async () => {
    await connected().migrator.query(`SET lock_timeout = '${LOCK_TIMEOUT_UNDER_TEST}'`);

    const rejection = await withoutLockTimeout(connected().migrator, () => connected().migrator.query(`
      CREATE INDEX CONCURRENTLY "mappings_source_idx" ON "mappings" ("missingColumn")
    `)).then(() => null, (error: unknown) => error);

    expect(rejection).not.toBeNull();
    expect(await currentLockTimeout(connected().migrator)).toBe(BLOCKING_LOCK_TIMEOUT);
  });
});
