import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { readUserAgentFeedbackEnabled } from "../../src/database/user-agent-feedback";
import { closeDatabase, createDatabase } from "../../src/utils/database";
import { MIGRATION_LOCK_NAME } from "../../src/database/roles";
import type { ProvisionReport } from "../../src/database/roles";

const SUPERUSER_DATABASE_URL = Bun.env.MIGRATION_TEST_DATABASE_URL;

if (!SUPERUSER_DATABASE_URL) {
  throw new Error("MIGRATION_TEST_DATABASE_URL is missing");
}

const PACKAGE_ROOT = `${import.meta.dirname}/../..`;
const DRIZZLE_DIRECTORY = `${PACKAGE_ROOT}/drizzle`;
const FIRST_MIGRATION_RUN_BY_THE_MIGRATION_ROLE = "0113_user_sign_up_attributions";
const TABLE_CREATED_BY_THE_MIGRATION_ROLE = "user_sign_up_attributions";
const INSUFFICIENT_PRIVILEGE = "42501";

const SUFFIX = process.pid;
const DATABASE_NAME = `keeper_roles_${SUFFIX}`;
const EMPTY_DATABASE_NAME = `keeper_roles_empty_${SUFFIX}`;
const ADMINISTRATOR = `keeper_roles_admin_${SUFFIX}`;
const OWNER = `keeper_roles_owner_${SUFFIX}`;
const MIGRATION = `keeper_roles_migrate_${SUFFIX}`;
const RUNTIME = `keeper_roles_app_${SUFFIX}`;
const MCP = `keeper_roles_mcp_${SUFFIX}`;

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

const urlFor = (role: string, databaseName: string = DATABASE_NAME): string => {
  const url = new URL(SUPERUSER_DATABASE_URL);
  url.username = role;
  url.password = `${role}-password`;
  url.pathname = `/${databaseName}`;
  return url.toString();
};

const superuserUrl = (): string => {
  const url = new URL(SUPERUSER_DATABASE_URL);
  url.pathname = `/${DATABASE_NAME}`;
  return url.toString();
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

const dropEverything = (): Promise<void> =>
  withConnection(SUPERUSER_DATABASE_URL, async (superuser) => {
    await superuser.query(`DROP DATABASE IF EXISTS "${DATABASE_NAME}" WITH (FORCE)`);
    await superuser.query(`DROP DATABASE IF EXISTS "${EMPTY_DATABASE_NAME}" WITH (FORCE)`);
    for (const role of [MCP, RUNTIME, MIGRATION, OWNER, ADMINISTRATOR]) {
      await superuser.query(`DROP ROLE IF EXISTS "${role}"`);
    }
  });

const createAdministeredDatabase = async (): Promise<void> => {
  await withConnection(SUPERUSER_DATABASE_URL, async (superuser) => {
    await superuser.query(
      `CREATE ROLE "${ADMINISTRATOR}" LOGIN CREATEROLE CREATEDB PASSWORD '${ADMINISTRATOR}-password'`,
    );
  });
  await withConnection(urlFor(ADMINISTRATOR, "postgres"), async (administrator) => {
    await administrator.query(`CREATE DATABASE "${DATABASE_NAME}"`);
  });
};

const applyMigrationsBefore = async (databaseUrl: string, tag: string): Promise<void> => {
  const journal = await Bun.file(`${DRIZZLE_DIRECTORY}/meta/_journal.json`)
    .json() as Journal;
  const boundary = journal.entries.find((entry) => entry.tag === tag);
  if (!boundary) {
    throw new Error(`Migration ${tag} is missing from the journal`);
  }
  const entries = journal.entries.filter(({ idx }) => idx < boundary.idx);
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
  try {
    await withConnection(databaseUrl, (client) =>
      migrate(drizzle(client), { migrationsFolder: folder }));
  } finally {
    await rm(folder, { force: true, recursive: true });
  }
};

const runScript = async (script: string, env: Record<string, string>): Promise<string> => {
  const runner = Bun.spawn(["bun", `scripts/${script}`], {
    cwd: PACKAGE_ROOT,
    env: { ...Bun.env, ...env },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, output, failure] = await Promise.all([
    runner.exited,
    new Response(runner.stdout).text(),
    new Response(runner.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`${script} exited ${exitCode}: ${failure}`);
  }
  return output;
};

const provisionRoles = async (databaseName: string = DATABASE_NAME): Promise<ProvisionReport> =>
  JSON.parse(await runScript("roles.ts", {
    DATABASE_MCP_CONNECTION_LIMIT: "5",
    DATABASE_MCP_URL: urlFor(MCP, databaseName),
    DATABASE_MIGRATION_URL: urlFor(MIGRATION, databaseName),
    DATABASE_OWNER_ROLE: OWNER,
    DATABASE_RUNTIME_CONNECTION_LIMIT: "20",
    DATABASE_RUNTIME_URL: urlFor(RUNTIME, databaseName),
    DATABASE_URL: urlFor(ADMINISTRATOR, databaseName),
  })) as ProvisionReport;

const readOwners = (schemas: string[]): Promise<string[]> =>
  withConnection(superuserUrl(), async (superuser) => {
    const result = await superuser.query<{ owner: string }>(
      `SELECT DISTINCT pg_get_userbyid(owner) AS owner FROM (
         SELECT relation.relowner AS owner
         FROM pg_class relation
         INNER JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = ANY($1::text[])
         UNION ALL
         SELECT routine.proowner
         FROM pg_proc routine
         INNER JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
         WHERE namespace.nspname = ANY($1::text[])
       ) owned`,
      [schemas],
    );
    return result.rows.map(({ owner }) => owner);
  });

const expectDenied = async (client: Client, statement: string): Promise<void> => {
  await expect(client.query(statement)).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
};

let firstReport: ProvisionReport | null = null;

describe("separate database roles", () => {
  beforeAll(async () => {
    await dropEverything();
    await createAdministeredDatabase();
    await applyMigrationsBefore(urlFor(ADMINISTRATOR), FIRST_MIGRATION_RUN_BY_THE_MIGRATION_ROLE);
    firstReport = await provisionRoles();
    await runScript("migrate.ts", { DATABASE_URL: urlFor(MIGRATION) });
  });

  afterAll(async () => {
    await dropEverything();
  });

  it("hands every existing object to the owner and closes the database to other roles", async () => {
    expect(firstReport?.ownershipTransfers).toBeGreaterThan(0);
    expect(firstReport?.pending).toEqual([]);
    expect(firstReport?.mcpTables).toEqual([`"public"."oauth_resource"`, `"public"."user"`]);
    expect(firstReport?.publicPrivileges).toEqual([]);
    expect(await readOwners(["public", "drizzle"])).toEqual([OWNER]);
  });

  it("creates only unprivileged roles, with the migration role alone joining the owner", () => {
    const provisioned = firstReport?.roles.filter(({ name }) =>
      [OWNER, MIGRATION, RUNTIME, MCP].includes(name));

    expect(provisioned).toEqual([
      { connectionLimit: 20, elevated: false, login: true, memberOf: [], name: RUNTIME },
      { connectionLimit: 5, elevated: false, login: true, memberOf: [], name: MCP },
      { connectionLimit: -1, elevated: false, login: true, memberOf: [OWNER], name: MIGRATION },
      { connectionLimit: -1, elevated: false, login: false, memberOf: [], name: OWNER },
    ]);
  });

  it("stores each password as a SCRAM verifier", async () => {
    const stored = await withConnection(superuserUrl(), (superuser) =>
      superuser.query<{ password: string }>(
        "SELECT rolpassword AS password FROM pg_authid WHERE rolname = ANY($1::text[])",
        [[MIGRATION, RUNTIME, MCP]],
      ));

    expect(stored.rows).toHaveLength(3);
    for (const { password } of stored.rows) {
      expect(password).toMatch(/^SCRAM-SHA-256\$4096:/);
    }
  });

  it("lets the migration role migrate, leaving new tables owned by the owner and open to the runtime role", async () => {
    const table = await withConnection(superuserUrl(), (superuser) =>
      superuser.query<{ owner: string }>(
        "SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = to_regclass($1)",
        [`public.${TABLE_CREATED_BY_THE_MIGRATION_ROLE}`],
      ));
    expect(table.rows).toEqual([{ owner: OWNER }]);
    expect(await readOwners(["public", "drizzle"])).toEqual([OWNER]);

    await withConnection(urlFor(RUNTIME), async (runtime) => {
      const rows = await runtime.query(`SELECT * FROM "${TABLE_CREATED_BY_THE_MIGRATION_ROLE}"`);
      expect(rows.rows).toEqual([]);
    });
  });

  it("lets the runtime role read and write rows through the schedule triggers", async () => {
    await withConnection(urlFor(RUNTIME), async (runtime) => {
      await runtime.query(
        `INSERT INTO "user" ("id", "email", "name") VALUES ('runtime-user', 'runtime@keeper.test', 'Runtime')`,
      );
      const account = await runtime.query<{ id: string }>(
        `INSERT INTO "calendar_accounts" ("authType", "provider", "userId")
         VALUES ('oauth', 'google', 'runtime-user') RETURNING "id"`,
      );
      const calendar = await runtime.query<{ id: string }>(
        `INSERT INTO "calendars" ("accountId", "calendarType", "capabilities", "name", "userId")
         VALUES ($1, 'oauth', $2, 'Runtime', 'runtime-user') RETURNING "id"`,
        [account.rows[0]?.id, ["pull", "push"]],
      );
      const scheduled = await runtime.query(
        `SELECT 1 FROM "source_ingest_schedule" WHERE "calendarId" = $1`,
        [calendar.rows[0]?.id],
      );
      expect(scheduled.rowCount).toBe(1);

      await runtime.query(`UPDATE "user" SET "name" = 'Renamed' WHERE "id" = 'runtime-user'`);
      await runtime.query(`SELECT pg_advisory_xact_lock(1, hashtext('runtime-user'))`);
      await runtime.query(`SELECT set_config('statement_timeout', '1000', true)`);
      const removed = await runtime.query(`DELETE FROM "user" WHERE "id" = 'runtime-user'`);
      expect(removed.rowCount).toBe(1);
    });
  });

  it("stops the runtime role changing the schema, managing roles or reading credentials", async () => {
    await withConnection(urlFor(RUNTIME), async (runtime) => {
      await expectDenied(runtime, `CREATE TABLE "public"."intruder" ("id" int)`);
      await expectDenied(runtime, `CREATE TEMP TABLE "intruder" ("id" int)`);
      await expectDenied(runtime, `CREATE SCHEMA "intruder"`);
      await expectDenied(runtime, `ALTER TABLE "user" ADD COLUMN "intruder" text`);
      await expectDenied(runtime, `DROP TABLE "user" CASCADE`);
      await expectDenied(runtime, `TRUNCATE "user" CASCADE`);
      await expectDenied(runtime, `CREATE INDEX "intruder" ON "user" ("name")`);
      await expectDenied(
        runtime,
        `CREATE TRIGGER "intruder" BEFORE INSERT ON "user" EXECUTE FUNCTION "source_ingest_schedule_wake_user"()`,
      );
      await expectDenied(runtime, `CREATE ROLE "intruder_${SUFFIX}"`);
      await expectDenied(runtime, `ALTER ROLE "${RUNTIME}" CREATEROLE`);
      await expectDenied(runtime, `SET ROLE "${OWNER}"`);
      await expectDenied(runtime, `GRANT "${OWNER}" TO "${RUNTIME}"`);
      await expectDenied(runtime, `SELECT rolpassword FROM pg_authid`);
      await expectDenied(runtime, `SELECT * FROM "drizzle"."__drizzle_migrations"`);
      await expectDenied(runtime, `CREATE EXTENSION "dblink"`);
    });
  });

  it("limits the mcp role to reading the agent feedback preference and the OAuth resources", async () => {
    await withConnection(superuserUrl(), (superuser) =>
      superuser.query(
        `INSERT INTO "user" ("id", "email", "name", "agentFeedbackEnabled")
         VALUES ('mcp-user', 'mcp@keeper.test', 'Mcp', false)`,
      ));
    const database = await createDatabase(urlFor(MCP), { maxConnections: 1 });
    try {
      expect(await readUserAgentFeedbackEnabled(database, "mcp-user")).toBe(false);
    } finally {
      closeDatabase(database, { graceSeconds: 1 });
    }

    await withConnection(urlFor(MCP), async (mcp) => {
      const resources = await mcp.query(`SELECT * FROM "oauth_resource"`);
      expect(resources.rows).toEqual([]);
      await expectDenied(mcp, `INSERT INTO "oauth_resource" ("id", "identifier", "name") VALUES ('intruder', 'https://intruder.test', 'Intruder')`);
      await expectDenied(mcp, `SELECT "email" FROM "user"`);
      await expectDenied(mcp, `SELECT * FROM "user"`);
      await expectDenied(mcp, `SELECT * FROM "session"`);
      await expectDenied(mcp, `SELECT * FROM "oauth_credentials"`);
      await expectDenied(mcp, `SELECT * FROM "${TABLE_CREATED_BY_THE_MIGRATION_ROLE}"`);
      await expectDenied(mcp, `UPDATE "user" SET "agentFeedbackEnabled" = true`);
      await expectDenied(mcp, `DELETE FROM "user"`);
      await expectDenied(mcp, `CREATE TABLE "public"."intruder" ("id" int)`);
      await expectDenied(mcp, `SELECT rolpassword FROM pg_authid`);
    });
  });

  it("keeps the migration role powerless unless it acts as the owner", async () => {
    await withConnection(urlFor(MIGRATION), async (migration) => {
      const acting = await migration.query<{ current: string; session: string }>(
        "SELECT current_user::text AS current, session_user::text AS session",
      );
      expect(acting.rows).toEqual([{ current: OWNER, session: MIGRATION }]);

      await migration.query("SET ROLE NONE");
      await expectDenied(migration, `CREATE TABLE "public"."intruder" ("id" int)`);
      await expectDenied(migration, `SELECT * FROM "user"`);
      await expectDenied(migration, `CREATE ROLE "intruder_${SUFFIX}"`);
    });
  });

  it("converges when run again, adopting tables the administrator created in between", async () => {
    await withConnection(urlFor(ADMINISTRATOR), (administrator) =>
      administrator.query(`CREATE TABLE "public"."interim" ("id" int PRIMARY KEY)`));
    await withConnection(urlFor(RUNTIME), (runtime) =>
      runtime.query(`INSERT INTO "interim" ("id") VALUES (1)`));

    const open = new Client({ connectionString: urlFor(RUNTIME) });
    await open.connect();
    try {
      const second = await provisionRoles();
      expect(second.ownershipTransfers).toBe(1);
      expect(second.connections[RUNTIME]).toBe(1);
      expect(await readOwners(["public", "drizzle"])).toEqual([OWNER]);

      const third = await provisionRoles();
      expect(third.ownershipTransfers).toBe(0);
      expect(third.roles).toEqual(second.roles);

      const kept = await open.query(`SELECT "id" FROM "interim"`);
      expect(kept.rows).toEqual([{ id: 1 }]);
    } finally {
      await open.end();
    }
    await withConnection(urlFor(MIGRATION), (migration) =>
      migration.query(`DROP TABLE "interim"`));
  });

  it("waits for a migration in progress before changing anything", async () => {
    const migrateScript = await Bun.file(`${PACKAGE_ROOT}/scripts/migrate.ts`).text();
    expect(migrateScript).toContain(`pg_advisory_lock(hashtext('${MIGRATION_LOCK_NAME}'))`);

    const migrating = new Client({ connectionString: urlFor(ADMINISTRATOR) });
    await migrating.connect();
    try {
      await migrating.query("SELECT pg_advisory_lock(hashtext($1))", [MIGRATION_LOCK_NAME]);
      const provisioning = provisionRoles();
      const outcome = await Promise.race([
        provisioning.then(() => "provisioned"),
        Bun.sleep(1500).then(() => "waiting"),
      ]);
      expect(outcome).toBe("waiting");

      await migrating.query("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK_NAME]);
      const report = await provisioning;
      expect(report.ownershipTransfers).toBe(0);
    } finally {
      await migrating.end();
    }
  });

  it("prepares an empty database for its first migration and finishes on the run after it", async () => {
    await withConnection(urlFor(ADMINISTRATOR, "postgres"), (administrator) =>
      administrator.query(`CREATE DATABASE "${EMPTY_DATABASE_NAME}"`));

    const before = await provisionRoles(EMPTY_DATABASE_NAME);
    expect(before.mcpTables).toEqual([]);
    expect(before.pending).toHaveLength(2);

    await runScript("migrate.ts", { DATABASE_URL: urlFor(MIGRATION, EMPTY_DATABASE_NAME) });
    await withConnection(urlFor(RUNTIME, EMPTY_DATABASE_NAME), async (runtime) => {
      const users = await runtime.query(`SELECT * FROM "user"`);
      expect(users.rows).toEqual([]);
    });

    const after = await provisionRoles(EMPTY_DATABASE_NAME);
    expect(after.ownershipTransfers).toBe(0);
    expect(after.pending).toEqual([]);
    expect(after.mcpTables).toEqual([`"public"."oauth_resource"`, `"public"."user"`]);
  });

  it("leaves the administrator able to use everything while services still connect as it", async () => {
    await withConnection(urlFor(ADMINISTRATOR), async (administrator) => {
      await administrator.query(
        `INSERT INTO "user" ("id", "email", "name") VALUES ('administrator-user', 'administrator@keeper.test', 'Administrator')`,
      );
      await administrator.query(`ALTER TABLE "user" ADD COLUMN "administratorProbe" text`);
      await administrator.query(`ALTER TABLE "user" DROP COLUMN "administratorProbe"`);
      const removed = await administrator.query(`DELETE FROM "user" WHERE "id" = 'administrator-user'`);
      expect(removed.rowCount).toBe(1);
    });
  });
});
