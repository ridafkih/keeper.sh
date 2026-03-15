import { isKeeperMcpEnabledAuth, createAuth } from "@keeper.sh/auth";
import { createDatabase } from "@keeper.sh/database";
import env from "@keeper.sh/env/mcp";
import { createKeeperMcpHandler } from "./mcp-handler";
import { createKeeperMcpToolset } from "./toolset";
import { withWideEvent } from "./utils/middleware";

const database = createDatabase(env.DATABASE_URL);

const { auth: baseAuth } = createAuth({
  database,
  secret: env.BETTER_AUTH_SECRET,
  baseUrl: env.BETTER_AUTH_URL,
  commercialMode: env.COMMERCIAL_MODE ?? false,
  mcpResourceUrl: env.MCP_PUBLIC_URL,
});

if (!isKeeperMcpEnabledAuth(baseAuth)) {
  throw new Error("MCP auth is not configured — ensure mcpResourceUrl is set");
}

const auth = baseAuth;
const keeperMcpToolset = createKeeperMcpToolset();
const handleMcpRequest = createKeeperMcpHandler({
  auth,
  mcpPublicUrl: env.MCP_PUBLIC_URL,
  apiBaseUrl: env.BETTER_AUTH_URL,
  toolset: keeperMcpToolset,
});

export { auth, database, env, handleMcpRequest, keeperMcpToolset, withWideEvent };
