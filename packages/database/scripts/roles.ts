import { Client } from "pg";
import {
  assertRoleSessions,
  provisionDatabaseRoles,
  readRoleSession,
} from "../src/database/roles";
import type { LoginRole, RoleSession } from "../src/database/roles";

interface RoleConnection extends LoginRole {
  url: string;
}

const readRequired = (variable: string): string => {
  const value = Bun.env[variable];
  if (!value) {
    throw new Error(`${variable} is missing`);
  }
  return value;
};

const parseConnectionUrl = (variable: string, value: string): URL => {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${variable} is not a connection URL`);
  }
};

const readRoleConnection = (variable: string): RoleConnection => {
  const url = readRequired(variable);
  const parsed = parseConnectionUrl(variable, url);
  const name = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  if (!name || !password) {
    throw new Error(`${variable} needs a user and a password`);
  }
  return { name, password, url };
};

const readConnectionLimit = (variable: string): number | null => {
  const value = Bun.env[variable];
  if (!value) {
    return null;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`${variable} must be a positive whole number`);
  }
  return limit;
};

const withClient = async <Result>(
  client: Client,
  run: (client: Client) => Promise<Result>,
): Promise<Result> => {
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
};

const inspect = ({ url }: RoleConnection): Promise<RoleSession> =>
  withClient(new Client({ connectionString: url }), readRoleSession);

const migration = readRoleConnection("DATABASE_MIGRATION_URL");
const runtime = readRoleConnection("DATABASE_RUNTIME_URL");
const mcp = readRoleConnection("DATABASE_MCP_URL");

const roles = {
  mcp: {
    connectionLimit: readConnectionLimit("DATABASE_MCP_CONNECTION_LIMIT"),
    name: mcp.name,
    password: mcp.password,
  },
  migration: { name: migration.name, password: migration.password },
  owner: readRequired("DATABASE_OWNER_ROLE"),
  runtime: {
    connectionLimit: readConnectionLimit("DATABASE_RUNTIME_CONNECTION_LIMIT"),
    name: runtime.name,
    password: runtime.password,
  },
};

const report = await withClient(
  new Client({ connectionString: Bun.env.DATABASE_URL }),
  (client) => provisionDatabaseRoles(client, roles),
);

assertRoleSessions(
  {
    mcp: await inspect(mcp),
    migration: await inspect(migration),
    runtime: await inspect(runtime),
  },
  roles,
  report.mcpTables,
);

process.stdout.write(`${JSON.stringify(report)}\n`);
