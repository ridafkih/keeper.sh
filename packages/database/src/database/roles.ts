import { getTableName } from "drizzle-orm";
import { escapeIdentifier, escapeLiteral } from "pg";
import type { Client } from "pg";
import {
  DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  DEFAULT_STATEMENT_TIMEOUT_MS,
} from "../utils/database";
import { oauthResource } from "./auth-schema";
import { buildScramVerifier } from "./scram-verifier";
import { USER_AGENT_FEEDBACK_READ } from "./user-agent-feedback";

const APPLICATION_SCHEMA = "public";
const MIGRATION_SCHEMA = "drizzle";
const MANAGED_SCHEMAS = [APPLICATION_SCHEMA, MIGRATION_SCHEMA];
const MIGRATION_LOCK_NAME = "keeper.sh:database-migration";
const MINIMUM_SERVER_VERSION = 160_000;
const UNLIMITED_CONNECTIONS = -1;
const OWNERSHIP_LOCK_TIMEOUT = "2s";
const OWNERSHIP_ATTEMPTS = 20;
const OWNERSHIP_RETRY_DELAY_MS = 1000;
const LOCK_NOT_AVAILABLE = "55P03";

interface LoginRole {
  name: string;
  password: string;
}

interface ServiceRole extends LoginRole {
  connectionLimit: number | null;
}

interface DatabaseRoles {
  owner: string;
  migration: LoginRole;
  runtime: ServiceRole;
  mcp: ServiceRole;
}

interface McpRead {
  table: string;
  columns: string[] | null;
}

interface RoleAttributes {
  name: string;
  login: boolean;
  elevated: boolean;
  connectionLimit: number;
  memberOf: string[];
}

interface RoleSession {
  currentUser: string;
  sessionUser: string;
  createsInDatabase: boolean;
  createsInSchema: boolean;
  deniedTables: string[];
  reachableTables: string[];
}

interface RoleSessions {
  migration: RoleSession;
  runtime: RoleSession;
  mcp: RoleSession;
}

interface ProvisionReport {
  database: string;
  administrator: string;
  ownershipTransfers: number;
  pending: string[];
  mcpTables: string[];
  roles: RoleAttributes[];
  connections: Record<string, number>;
  publicPrivileges: string[];
}

const OWNERSHIP_TRANSFERS_QUERY = `
  WITH target AS (
    SELECT oid FROM pg_roles WHERE rolname = $2::text
  )
  SELECT format('ALTER TABLE %I.%I OWNER TO %I', namespace.nspname, relation.relname, $2::text) AS statement
  FROM pg_class relation
  INNER JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = ANY($1::text[])
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    AND relation.relowner <> (SELECT oid FROM target)
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend dependency
      WHERE dependency.classid = 'pg_class'::regclass
        AND dependency.objid = relation.oid
        AND (
          dependency.deptype = 'e'
          OR (relation.relkind = 'S' AND dependency.deptype IN ('a', 'i') AND dependency.refobjsubid <> 0)
        )
    )
  UNION ALL
  SELECT format('ALTER ROUTINE %s OWNER TO %I', routine.oid::regprocedure, $2::text)
  FROM pg_proc routine
  INNER JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
  WHERE namespace.nspname = ANY($1::text[])
    AND routine.proowner <> (SELECT oid FROM target)
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend dependency
      WHERE dependency.classid = 'pg_proc'::regclass
        AND dependency.objid = routine.oid
        AND dependency.deptype = 'e'
    )
  UNION ALL
  SELECT format('ALTER TYPE %s OWNER TO %I', datatype.oid::regtype, $2::text)
  FROM pg_type datatype
  INNER JOIN pg_namespace namespace ON namespace.oid = datatype.typnamespace
  LEFT JOIN pg_class composite ON composite.oid = datatype.typrelid
  WHERE namespace.nspname = ANY($1::text[])
    AND datatype.typowner <> (SELECT oid FROM target)
    AND (datatype.typtype IN ('e', 'd', 'r') OR composite.relkind = 'c')
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend dependency
      WHERE dependency.classid = 'pg_type'::regclass
        AND dependency.objid = datatype.oid
        AND dependency.deptype = 'e'
    )
`;

const quoted = (expression: string): string => `'"' || replace(${expression}, '"', '""') || '"'`;

const APPLICATION_RELATIONS = `
  SELECT
    relation.oid,
    relation.relkind,
    ${quoted("namespace.nspname")} || '.' || ${quoted("relation.relname")} AS identity
  FROM pg_class relation
  INNER JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = '${APPLICATION_SCHEMA}'
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend dependency
      WHERE dependency.classid = 'pg_class'::regclass
        AND dependency.objid = relation.oid
        AND dependency.deptype = 'e'
    )
`;

const APPLICATION_OBJECTS_QUERY = `
  SELECT
    ARRAY(SELECT identity FROM (${APPLICATION_RELATIONS}) relation WHERE relkind <> 'S' ORDER BY identity) AS tables,
    ARRAY(SELECT identity FROM (${APPLICATION_RELATIONS}) relation WHERE relkind = 'S' ORDER BY identity) AS sequences,
    ARRAY(
      SELECT routine.oid::regprocedure::text
      FROM pg_proc routine
      INNER JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = '${APPLICATION_SCHEMA}'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend dependency
          WHERE dependency.classid = 'pg_proc'::regclass
            AND dependency.objid = routine.oid
            AND dependency.deptype = 'e'
        )
      ORDER BY 1
    ) AS routines
`;

const ROLE_ATTRIBUTES_QUERY = `
  SELECT
    account.rolname::text AS name,
    account.rolcanlogin AS login,
    (
      account.rolsuper OR account.rolcreatedb OR account.rolcreaterole
      OR account.rolreplication OR account.rolbypassrls
    ) AS elevated,
    account.rolconnlimit AS "connectionLimit",
    ARRAY(
      SELECT DISTINCT parent.rolname::text
      FROM pg_auth_members membership
      INNER JOIN pg_roles parent ON parent.oid = membership.roleid
      WHERE membership.member = account.oid
        AND (membership.inherit_option OR membership.set_option)
      ORDER BY 1
    ) AS "memberOf"
  FROM pg_roles account
  WHERE account.rolname !~ '^pg_'
  ORDER BY account.rolname
`;

const ROLE_SESSION_QUERY = `
  SELECT
    current_user::text AS "currentUser",
    session_user::text AS "sessionUser",
    has_database_privilege(current_database(), 'CREATE') AS "createsInDatabase",
    has_schema_privilege('${APPLICATION_SCHEMA}', 'CREATE') AS "createsInSchema",
    ARRAY(
      SELECT identity FROM (${APPLICATION_RELATIONS}) relation
      WHERE relkind <> 'S' AND NOT (
        has_table_privilege(oid, 'SELECT') AND has_table_privilege(oid, 'INSERT')
        AND has_table_privilege(oid, 'UPDATE') AND has_table_privilege(oid, 'DELETE')
      )
      ORDER BY identity
    ) AS "deniedTables",
    ARRAY(
      SELECT identity FROM (${APPLICATION_RELATIONS}) relation
      WHERE relkind <> 'S' AND (
        has_any_column_privilege(oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        OR has_table_privilege(oid, 'DELETE, TRUNCATE, TRIGGER')
      )
      ORDER BY identity
    ) AS "reachableTables"
`;

const CONNECTIONS_QUERY = `
  SELECT usename::text AS name, count(*)::int AS connections
  FROM pg_stat_activity
  WHERE datname = current_database() AND usename IS NOT NULL
  GROUP BY usename
`;

const PUBLIC_PRIVILEGES_QUERY = `
  SELECT ARRAY(
    SELECT privilege FROM (
      VALUES
        ('database connect', has_database_privilege('public', current_database(), 'CONNECT')),
        ('database temporary', has_database_privilege('public', current_database(), 'TEMPORARY')),
        ('schema create', has_schema_privilege('public', '${APPLICATION_SCHEMA}', 'CREATE'))
    ) AS held (privilege, granted)
    WHERE granted
  ) AS privileges
`;

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const describeList = (names: string[]): string => `[${names.join(", ")}]`;

const isLockTimeout = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === LOCK_NOT_AVAILABLE;

const identify = (table: string): string =>
  `${escapeIdentifier(APPLICATION_SCHEMA)}.${escapeIdentifier(table)}`;

const MCP_READS: McpRead[] = [
  {
    columns: USER_AGENT_FEEDBACK_READ.columns.map((column) => column.name),
    table: identify(getTableName(USER_AGENT_FEEDBACK_READ.table)),
  },
  { columns: null, table: identify(getTableName(oauthResource)) },
];

const assertDistinctRoles = (roles: DatabaseRoles, administrator: string): void => {
  const names = [roles.owner, roles.migration.name, roles.runtime.name, roles.mcp.name];
  if (names.some((name) => name.length === 0)) {
    throw new Error("Every database role needs a name");
  }
  if (new Set([...names, administrator]).size !== names.length + 1) {
    throw new Error("The owner, migration, runtime, mcp and administrative roles must all differ");
  }
};

const readSessionFacts = async (
  connection: Client,
): Promise<{ administrator: string; database: string; version: number }> => {
  const result = await connection.query<{ administrator: string; database: string; version: number }>(`
    SELECT
      current_user::text AS administrator,
      current_database()::text AS database,
      current_setting('server_version_num')::int AS version
  `);
  const [facts] = result.rows;
  if (!facts) {
    throw new Error("The database did not describe the administrative session");
  }
  return facts;
};

const ensureRole = async (connection: Client, name: string): Promise<void> => {
  const existing = await connection.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [name]);
  if (existing.rowCount === 0) {
    await connection.query(`CREATE ROLE ${escapeIdentifier(name)}`);
  }
};

const configureLogin = async (
  connection: Client,
  role: LoginRole,
  connectionLimit: number | null,
): Promise<void> => {
  await ensureRole(connection, role.name);
  await connection.query(`
    ALTER ROLE ${escapeIdentifier(role.name)}
    WITH LOGIN NOCREATEDB NOCREATEROLE
    CONNECTION LIMIT ${connectionLimit ?? UNLIMITED_CONNECTIONS}
    PASSWORD ${escapeLiteral(buildScramVerifier(role.password))}
  `);
  await connection.query(
    `ALTER ROLE ${escapeIdentifier(role.name)} SET search_path = ${escapeIdentifier(APPLICATION_SCHEMA)}`,
  );
};

const configureOwner = async (connection: Client, owner: string): Promise<void> => {
  await ensureRole(connection, owner);
  await connection.query(`ALTER ROLE ${escapeIdentifier(owner)} WITH NOLOGIN NOCREATEDB NOCREATEROLE`);
  await connection.query(`GRANT ${escapeIdentifier(owner)} TO CURRENT_USER WITH INHERIT TRUE, SET TRUE`);
};

const configureMigration = async (connection: Client, roles: DatabaseRoles): Promise<void> => {
  const migration = escapeIdentifier(roles.migration.name);
  await configureLogin(connection, roles.migration, null);
  await connection.query(
    `GRANT ${escapeIdentifier(roles.owner)} TO ${migration} WITH INHERIT FALSE, SET TRUE`,
  );
  await connection.query(`ALTER ROLE ${migration} SET role = ${escapeLiteral(roles.owner)}`);
};

const configureService = async (connection: Client, role: ServiceRole): Promise<void> => {
  const name = escapeIdentifier(role.name);
  await configureLogin(connection, role, role.connectionLimit);
  await connection.query(
    `ALTER ROLE ${name} SET statement_timeout = ${DEFAULT_STATEMENT_TIMEOUT_MS}`,
  );
  await connection.query(
    `ALTER ROLE ${name} SET idle_in_transaction_session_timeout = ${DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS}`,
  );
};

const grantDatabaseAccess = async (
  connection: Client,
  database: string,
  roles: DatabaseRoles,
): Promise<void> => {
  const name = escapeIdentifier(database);
  const logins = [roles.migration.name, roles.runtime.name, roles.mcp.name]
    .map((role) => escapeIdentifier(role))
    .join(", ");
  await connection.query(`GRANT CONNECT ON DATABASE ${name} TO ${logins}`);
  await connection.query(
    `GRANT CREATE, TEMPORARY ON DATABASE ${name} TO ${escapeIdentifier(roles.owner)}`,
  );
  await connection.query(`REVOKE ALL ON DATABASE ${name} FROM PUBLIC`);
};

const grantSchemaAccess = async (connection: Client, roles: DatabaseRoles): Promise<void> => {
  const owner = escapeIdentifier(roles.owner);
  const application = escapeIdentifier(APPLICATION_SCHEMA);
  await connection.query(`REVOKE CREATE ON SCHEMA ${application} FROM PUBLIC`);
  await connection.query(`GRANT USAGE, CREATE ON SCHEMA ${application} TO ${owner}`);
  await connection.query(`
    GRANT USAGE ON SCHEMA ${application}
    TO ${escapeIdentifier(roles.runtime.name)}, ${escapeIdentifier(roles.mcp.name)}
  `);
  const bookkeeping = await connection.query(
    "SELECT 1 FROM pg_namespace WHERE nspname = $1",
    [MIGRATION_SCHEMA],
  );
  if (bookkeeping.rowCount !== 0) {
    await connection.query(
      `GRANT USAGE, CREATE ON SCHEMA ${escapeIdentifier(MIGRATION_SCHEMA)} TO ${owner}`,
    );
  }
};

const transferOwnership = async (connection: Client, statement: string): Promise<void> => {
  for (let attempt = 1; ; attempt++) {
    try {
      await connection.query(statement);
      return;
    } catch (error) {
      if (!isLockTimeout(error) || attempt === OWNERSHIP_ATTEMPTS) {
        throw error;
      }
      await sleep(OWNERSHIP_RETRY_DELAY_MS);
    }
  }
};

const transferOwnerships = async (connection: Client, owner: string): Promise<number> => {
  const transfers = await connection.query<{ statement: string }>(
    OWNERSHIP_TRANSFERS_QUERY,
    [MANAGED_SCHEMAS, owner],
  );
  for (const { statement } of transfers.rows) {
    await transferOwnership(connection, statement);
  }
  return transfers.rows.length;
};

const readApplicationObjects = async (
  connection: Client,
): Promise<{ routines: string[]; sequences: string[]; tables: string[] }> => {
  const result = await connection.query<{ routines: string[]; sequences: string[]; tables: string[] }>(
    APPLICATION_OBJECTS_QUERY,
  );
  const [objects] = result.rows;
  if (!objects) {
    throw new Error("The database did not list the application objects");
  }
  return objects;
};

const grantRuntimeAccess = async (
  connection: Client,
  runtime: string,
  objects: { routines: string[]; sequences: string[]; tables: string[] },
): Promise<void> => {
  const role = escapeIdentifier(runtime);
  if (objects.tables.length > 0) {
    await connection.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${objects.tables.join(", ")} TO ${role}`,
    );
  }
  if (objects.sequences.length > 0) {
    await connection.query(
      `GRANT USAGE, SELECT ON SEQUENCE ${objects.sequences.join(", ")} TO ${role}`,
    );
  }
  if (objects.routines.length > 0) {
    const routines = objects.routines.join(", ");
    await connection.query(`GRANT EXECUTE ON ROUTINE ${routines} TO ${role}`);
    await connection.query(`REVOKE EXECUTE ON ROUTINE ${routines} FROM PUBLIC`);
  }
};

const isReadable = async (connection: Client, { columns, table }: McpRead): Promise<boolean> => {
  const result = await connection.query<{ present: number; relation: string | null }>(
    `SELECT
       to_regclass($1)::text AS relation,
       (
         SELECT count(*)::int FROM pg_attribute
         WHERE attrelid = to_regclass($1) AND attname = ANY($2::text[]) AND NOT attisdropped
       ) AS present`,
    [table, columns ?? []],
  );
  const [found] = result.rows;
  return found?.relation !== null && found?.present === (columns ?? []).length;
};

const describeRead = ({ columns, table }: McpRead): string => {
  if (columns === null) {
    return `GRANT SELECT ON TABLE ${table}`;
  }
  const names = columns.map((column) => escapeIdentifier(column)).join(", ");
  return `GRANT SELECT (${names}) ON TABLE ${table}`;
};

const grantMcpAccess = async (
  connection: Client,
  mcp: string,
  tables: string[],
): Promise<{ mcpTables: string[]; pending: string[] }> => {
  const role = escapeIdentifier(mcp);
  const readable: McpRead[] = [];
  const pending: string[] = [];
  for (const read of MCP_READS) {
    if (await isReadable(connection, read)) {
      readable.push(read);
    } else {
      pending.push(`${mcp} cannot read ${read.table} until migrations create it; run this again afterwards`);
    }
  }
  await connection.query("BEGIN");
  try {
    if (tables.length > 0) {
      await connection.query(`REVOKE ALL ON TABLE ${tables.join(", ")} FROM ${role}`);
    }
    for (const read of readable) {
      await connection.query(`${describeRead(read)} TO ${role}`);
    }
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  }
  return { mcpTables: readable.map(({ table }) => table).toSorted(), pending };
};

const setDefaultPrivileges = async (
  connection: Client,
  administrator: string,
  roles: DatabaseRoles,
): Promise<void> => {
  const owner = escapeIdentifier(roles.owner);
  const creators = `${owner}, ${escapeIdentifier(administrator)}`;
  const runtime = escapeIdentifier(roles.runtime.name);
  const application = escapeIdentifier(APPLICATION_SCHEMA);
  await connection.query(`
    ALTER DEFAULT PRIVILEGES FOR ROLE ${creators} IN SCHEMA ${application}
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${runtime}
  `);
  await connection.query(`
    ALTER DEFAULT PRIVILEGES FOR ROLE ${creators} IN SCHEMA ${application}
    GRANT USAGE, SELECT ON SEQUENCES TO ${runtime}
  `);
  await connection.query(`
    ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${application}
    GRANT EXECUTE ON ROUTINES TO ${runtime}
  `);
  await connection.query(`
    ALTER DEFAULT PRIVILEGES FOR ROLE ${owner}
    REVOKE EXECUTE ON ROUTINES FROM PUBLIC
  `);
};

const readRoleAttributes = async (connection: Client): Promise<RoleAttributes[]> => {
  const result = await connection.query<RoleAttributes>(ROLE_ATTRIBUTES_QUERY);
  return result.rows;
};

const assertRoleAttributes = (attributes: RoleAttributes[], roles: DatabaseRoles): void => {
  const expectations = [
    { login: false, memberOf: [], name: roles.owner },
    { login: true, memberOf: [roles.owner], name: roles.migration.name },
    { login: true, memberOf: [], name: roles.runtime.name },
    { login: true, memberOf: [], name: roles.mcp.name },
  ];
  for (const expected of expectations) {
    const actual = attributes.find(({ name }) => name === expected.name);
    if (!actual) {
      throw new Error(`Role ${expected.name} does not exist`);
    }
    if (actual.elevated) {
      throw new Error(`Role ${expected.name} holds an administrative attribute`);
    }
    if (actual.login !== expected.login) {
      throw new Error(`Role ${expected.name} has the wrong login setting`);
    }
    if (describeList(actual.memberOf) !== describeList(expected.memberOf)) {
      throw new Error(
        `Role ${expected.name} is a member of ${describeList(actual.memberOf)}, expected ${describeList(expected.memberOf)}`,
      );
    }
  }
};

const readConnections = async (connection: Client): Promise<Record<string, number>> => {
  const result = await connection.query<{ connections: number; name: string }>(CONNECTIONS_QUERY);
  return Object.fromEntries(result.rows.map(({ connections, name }) => [name, connections]));
};

const readPublicPrivileges = async (connection: Client): Promise<string[]> => {
  const result = await connection.query<{ privileges: string[] }>(PUBLIC_PRIVILEGES_QUERY);
  return result.rows[0]?.privileges ?? [];
};

const provisionDatabaseRoles = async (
  connection: Client,
  roles: DatabaseRoles,
): Promise<ProvisionReport> => {
  await connection.query("SELECT set_config('search_path', '', false)");
  const { administrator, database, version } = await readSessionFacts(connection);
  if (version < MINIMUM_SERVER_VERSION) {
    throw new Error("Separate database roles need PostgreSQL 16 or newer");
  }
  assertDistinctRoles(roles, administrator);
  await connection.query("SELECT pg_advisory_lock(hashtext($1))", [MIGRATION_LOCK_NAME]);
  await connection.query(`SET lock_timeout = '${OWNERSHIP_LOCK_TIMEOUT}'`);

  await configureOwner(connection, roles.owner);
  await configureMigration(connection, roles);
  await configureService(connection, roles.runtime);
  await configureService(connection, roles.mcp);
  await grantDatabaseAccess(connection, database, roles);
  await grantSchemaAccess(connection, roles);
  const ownershipTransfers = await transferOwnerships(connection, roles.owner);
  const objects = await readApplicationObjects(connection);
  await grantRuntimeAccess(connection, roles.runtime.name, objects);
  const { mcpTables, pending } = await grantMcpAccess(connection, roles.mcp.name, objects.tables);
  await setDefaultPrivileges(connection, administrator, roles);

  const attributes = await readRoleAttributes(connection);
  assertRoleAttributes(attributes, roles);

  return {
    administrator,
    connections: await readConnections(connection),
    database,
    mcpTables,
    ownershipTransfers,
    pending,
    publicPrivileges: await readPublicPrivileges(connection),
    roles: attributes,
  };
};

const readRoleSession = async (connection: Client): Promise<RoleSession> => {
  const result = await connection.query<RoleSession>(ROLE_SESSION_QUERY);
  const [session] = result.rows;
  if (!session) {
    throw new Error("The database did not describe the role session");
  }
  return session;
};

const assertRoleSessions = (
  sessions: RoleSessions,
  roles: DatabaseRoles,
  mcpTables: string[],
): void => {
  const { migration, runtime, mcp } = sessions;
  if (migration.sessionUser !== roles.migration.name || migration.currentUser !== roles.owner) {
    throw new Error(`${roles.migration.name} does not act as ${roles.owner}`);
  }
  if (!migration.createsInSchema || migration.deniedTables.length > 0) {
    throw new Error(`${roles.owner} cannot change the application schema`);
  }
  for (const [expected, session] of [[roles.runtime.name, runtime], [roles.mcp.name, mcp]] as const) {
    if (session.sessionUser !== expected || session.currentUser !== expected) {
      throw new Error(`${expected} does not act as itself`);
    }
    if (session.createsInDatabase || session.createsInSchema) {
      throw new Error(`${expected} can create objects`);
    }
  }
  if (runtime.deniedTables.length > 0) {
    throw new Error(`${roles.runtime.name} cannot use ${runtime.deniedTables.join(", ")}`);
  }
  const reachable = mcp.reachableTables.toSorted();
  if (describeList(reachable) !== describeList(mcpTables)) {
    throw new Error(
      `${roles.mcp.name} reaches ${describeList(reachable)}, expected ${describeList(mcpTables)}`,
    );
  }
};

export { assertRoleSessions, MIGRATION_LOCK_NAME, provisionDatabaseRoles, readRoleSession };
export type { DatabaseRoles, LoginRole, ProvisionReport, RoleSession, RoleSessions, ServiceRole };
