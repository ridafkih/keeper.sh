import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import {
  appRewrittenColumns,
  SERVER_CLOCK_REPAIR_PLAN_QUERY,
} from "../../src/database/server-clock-timestamps";
import { SCHEMA_TABLES } from "../../src/database/schema-tables";

const ADMIN_DATABASE_URL = Bun.env.MIGRATION_TEST_DATABASE_URL;

if (!ADMIN_DATABASE_URL) {
  throw new Error("MIGRATION_TEST_DATABASE_URL is missing");
}

const PACKAGE_ROOT = `${import.meta.dirname}/../..`;
const DRIZZLE_DIRECTORY = `${PACKAGE_ROOT}/drizzle`;

const SCHEMA_BEFORE_TIMESTAMPTZ = 86;

const NON_UTC_ZONE = "Europe/Berlin";

const TRUE_INSTANT = "2026-01-15T09:30:00.000Z";
const SERVER_CLOCK_IN_BERLIN = "2026-01-15 10:30:00";
const SERVER_CLOCK_IN_UTC = "2026-01-15 09:30:00";
const APPLICATION_WRITTEN = "2026-01-15 09:30:00";
const APPLICATION_UPDATE = "2026-01-15 09:45:00";
const APPLICATION_UPDATE_INSTANT = "2026-01-15T09:45:00.000Z";

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

const createDatabase = async (zone: string | null): Promise<string> => {
  const name = `keeper_tz_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    if (zone) {
      await admin.query(`ALTER DATABASE "${name}" SET timezone = '${zone}'`);
    }
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

const seedPreTimestamptzRows = (serverClock: string) =>
  (client: Client): Promise<unknown> =>
    client.query(`
      INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES ('seed-user', 'Seed', 'seed@example.com', false,
        '${serverClock}', '${serverClock}');

      INSERT INTO "session"
        (id, token, "userId", "expiresAt", "createdAt", "updatedAt")
      VALUES ('seed-session', 'seed-token', 'seed-user',
        '${APPLICATION_WRITTEN}', '${serverClock}', '${serverClock}');

      INSERT INTO "caldav_credentials"
        (id, "serverUrl", username, "encryptedPassword", "createdAt", "updatedAt")
      VALUES
        ('11111111-1111-1111-1111-111111111111', 'https://untouched.example', 'u', 'p',
          '${serverClock}', '${serverClock}'),
        ('22222222-2222-2222-2222-222222222222', 'https://updated.example', 'u', 'p',
          '${serverClock}', '${APPLICATION_UPDATE}');
    `);

interface StoredInstants {
  userCreatedAt: string;
  userUpdatedAt: string;
  sessionExpiresAt: string;
  untouchedCreatedAt: string;
  untouchedUpdatedAt: string;
  updatedRowUpdatedAt: string;
}

interface StoredRow {
  user_created_at: Date;
  user_updated_at: Date;
  session_expires_at: Date;
  untouched_created_at: Date;
  untouched_updated_at: Date;
  updated_row_updated_at: Date;
}

const readInstants = async (client: Client): Promise<StoredInstants> => {
  const state = await client.query<StoredRow>(`
    SELECT
      (SELECT "createdAt" FROM "user" WHERE id = 'seed-user') AS user_created_at,
      (SELECT "updatedAt" FROM "user" WHERE id = 'seed-user') AS user_updated_at,
      (SELECT "expiresAt" FROM "session" WHERE id = 'seed-session') AS session_expires_at,
      (SELECT "createdAt" FROM "caldav_credentials"
        WHERE id = '11111111-1111-1111-1111-111111111111') AS untouched_created_at,
      (SELECT "updatedAt" FROM "caldav_credentials"
        WHERE id = '11111111-1111-1111-1111-111111111111') AS untouched_updated_at,
      (SELECT "updatedAt" FROM "caldav_credentials"
        WHERE id = '22222222-2222-2222-2222-222222222222') AS updated_row_updated_at
  `);
  const [row] = state.rows;
  if (!row) {
    throw new Error("The seeded rows are missing");
  }
  return {
    sessionExpiresAt: row.session_expires_at.toISOString(),
    untouchedCreatedAt: row.untouched_created_at.toISOString(),
    untouchedUpdatedAt: row.untouched_updated_at.toISOString(),
    updatedRowUpdatedAt: row.updated_row_updated_at.toISOString(),
    userCreatedAt: row.user_created_at.toISOString(),
    userUpdatedAt: row.user_updated_at.toISOString(),
  };
};

const columnTypes = async (client: Client): Promise<string[]> => {
  const state = await client.query<{ data_type: string }>(`
    SELECT DISTINCT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type LIKE 'timestamp%'
  `);
  return state.rows.map(({ data_type }) => data_type);
};

const repairPlan = async (client: Client): Promise<string[]> => {
  const plan = await client.query<{ statement: string }>(
    SERVER_CLOCK_REPAIR_PLAN_QUERY,
    [appRewrittenColumns(SCHEMA_TABLES), NON_UTC_ZONE],
  );
  return plan.rows.map(({ statement }) => statement);
};

const statementFor = (plan: string[], table: string, column: string): number =>
  plan.findIndex((statement) => statement.startsWith(`UPDATE ${table} SET ${column} `));

describe("the plan that moves server-clock timestamps to UTC", () => {
  const planForPreTimestamptzSchema = async (): Promise<string[]> => {
    const databaseUrl = await createDatabase(NON_UTC_ZONE);
    await applyReleasedSchemaState(databaseUrl, SCHEMA_BEFORE_TIMESTAMPTZ);
    return withConnection(databaseUrl, repairPlan);
  };

  it("moves every row of a column the application never writes", async () => {
    const plan = await planForPreTimestamptzSchema();

    expect(plan[statementFor(plan, '"user"', '"createdAt"')]).toBe(
      'UPDATE "user" SET "createdAt" = ("createdAt" AT TIME ZONE \'Europe/Berlin\')'
      + ' AT TIME ZONE \'UTC\' WHERE "createdAt" IS NOT NULL',
    );
  });

  it("moves only the untouched rows of a column the application rewrites", async () => {
    const plan = await planForPreTimestamptzSchema();

    expect(plan[statementFor(plan, "caldav_credentials", '"updatedAt"')])
      .toContain('AND "updatedAt" = "createdAt"');
  });

  it("repairs a rewritten column before the column it reads", async () => {
    const plan = await planForPreTimestamptzSchema();

    expect(statementFor(plan, "caldav_credentials", '"updatedAt"'))
      .toBeLessThan(statementFor(plan, "caldav_credentials", '"createdAt"'));
  });

  it("leaves a rewritten column alone when nothing can date its rows", async () => {
    const plan = await planForPreTimestamptzSchema();

    expect(plan.filter((statement) => statement.includes("user_subscriptions")))
      .toEqual([]);
  });
});

describe("upgrading a database that still stores naked timestamps", () => {
  it("preserves every instant on a UTC server", async () => {
    const databaseUrl = await createDatabase("UTC");
    await applyReleasedSchemaState(databaseUrl, SCHEMA_BEFORE_TIMESTAMPTZ);
    await withConnection(databaseUrl, seedPreTimestamptzRows(SERVER_CLOCK_IN_UTC));

    await runMigrationRunner(databaseUrl);

    const stored = await withConnection(databaseUrl, readInstants);
    expect(stored.userCreatedAt).toBe(TRUE_INSTANT);
    expect(stored.userUpdatedAt).toBe(TRUE_INSTANT);
    expect(stored.sessionExpiresAt).toBe(TRUE_INSTANT);
    expect(stored.untouchedCreatedAt).toBe(TRUE_INSTANT);
    expect(stored.untouchedUpdatedAt).toBe(TRUE_INSTANT);
    expect(stored.updatedRowUpdatedAt).toBe(APPLICATION_UPDATE_INSTANT);
    expect(await withConnection(databaseUrl, columnTypes))
      .toEqual(["timestamp with time zone"]);
  });

  it("preserves every instant on a server that was never UTC", async () => {
    const databaseUrl = await createDatabase(NON_UTC_ZONE);
    await applyReleasedSchemaState(databaseUrl, SCHEMA_BEFORE_TIMESTAMPTZ);
    await withConnection(databaseUrl, seedPreTimestamptzRows(SERVER_CLOCK_IN_BERLIN));

    await runMigrationRunner(databaseUrl);

    const stored = await withConnection(databaseUrl, readInstants);
    expect(stored.userCreatedAt).toBe(TRUE_INSTANT);
    expect(stored.userUpdatedAt).toBe(TRUE_INSTANT);
    expect(stored.sessionExpiresAt).toBe(TRUE_INSTANT);
    expect(stored.untouchedCreatedAt).toBe(TRUE_INSTANT);
    expect(stored.untouchedUpdatedAt).toBe(TRUE_INSTANT);
    expect(stored.updatedRowUpdatedAt).toBe(APPLICATION_UPDATE_INSTANT);
    expect(await withConnection(databaseUrl, columnTypes))
      .toEqual(["timestamp with time zone"]);
  });

  it("installs onto an empty database on a server that was never UTC", async () => {
    const databaseUrl = await createDatabase(NON_UTC_ZONE);

    await runMigrationRunner(databaseUrl);

    expect(await withConnection(databaseUrl, columnTypes))
      .toEqual(["timestamp with time zone"]);
  });
});

describe("re-running the migration on a database that already converted", () => {
  it("succeeds on a UTC server and moves nothing", async () => {
    const databaseUrl = await createDatabase("UTC");
    await applyReleasedSchemaState(databaseUrl, SCHEMA_BEFORE_TIMESTAMPTZ);
    await withConnection(databaseUrl, seedPreTimestamptzRows(SERVER_CLOCK_IN_UTC));
    await runMigrationRunner(databaseUrl);
    const first = await withConnection(databaseUrl, readInstants);

    await runMigrationRunner(databaseUrl);

    expect(await withConnection(databaseUrl, readInstants)).toEqual(first);
  });

  it("succeeds on a server that was never UTC and moves nothing", async () => {
    const databaseUrl = await createDatabase(NON_UTC_ZONE);
    await applyReleasedSchemaState(databaseUrl, SCHEMA_BEFORE_TIMESTAMPTZ);
    await withConnection(databaseUrl, seedPreTimestamptzRows(SERVER_CLOCK_IN_BERLIN));
    await runMigrationRunner(databaseUrl);
    const first = await withConnection(databaseUrl, readInstants);

    await runMigrationRunner(databaseUrl);

    expect(await withConnection(databaseUrl, readInstants)).toEqual(first);
    expect(first.userCreatedAt).toBe(TRUE_INSTANT);
  });
});
