import { asKeeperMcpEnabledAuth, createAuth } from "@keeper.sh/auth";
import { createDatabase } from "@keeper.sh/database";
import env from "@keeper.sh/env/mcp";
import { createKeeperApi } from "@keeper.sh/keeper-api";
import {
  createKeeperMcpHandler,
  createKeeperMcpToolset,
} from "@keeper.sh/mcp-server";

const database = createDatabase(env.DATABASE_URL);

const { auth: baseAuth } = createAuth({
  database,
  secret: env.BETTER_AUTH_SECRET,
  baseUrl: env.BETTER_AUTH_URL,
  commercialMode: env.COMMERCIAL_MODE ?? false,
  mcpResourceUrl: env.MCP_PUBLIC_URL,
  webBaseUrl: env.WEB_BASE_URL,
});

const auth = asKeeperMcpEnabledAuth(baseAuth);

const keeperApi = createKeeperApi(database);
const keeperMcpToolset = createKeeperMcpToolset(keeperApi);
const handleMcpRequest = createKeeperMcpHandler({
  auth,
  mcpPublicUrl: env.MCP_PUBLIC_URL,
  toolset: keeperMcpToolset,
});

export { auth, database, env, handleMcpRequest, keeperApi, keeperMcpToolset };
