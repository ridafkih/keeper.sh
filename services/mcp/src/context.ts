import { isKeeperMcpEnabledAuth, createAuth } from "@keeper.sh/auth";
import { createDatabase, readUserAgentFeedbackEnabled } from "@keeper.sh/database";
import env, { resolveApiBaseUrl } from "./env";
import { createAgentFeedbackAvailability } from "./agent-feedback-availability";
import { createKeeperMcpHandler } from "./mcp-handler";
import { buildIdentity } from "./build-identity";
import { resolveDeployment } from "./tools/feedback-tools";
import { createKeeperMcpToolset } from "./toolset";
import { withWideEvent } from "./utils/middleware";

const database = await createDatabase(env.DATABASE_URL, { maxConnections: env.DATABASE_POOL_MAX });

const { auth: baseAuth } = createAuth({
  database,
  secret: env.BETTER_AUTH_SECRET,
  baseUrl: env.BETTER_AUTH_URL,
  commercialMode: env.COMMERCIAL_MODE ?? false,
  mcpResourceUrl: env.MCP_PUBLIC_URL,
  mcpApiBaseUrl: env.MCP_API_URL,
});

if (!isKeeperMcpEnabledAuth(baseAuth)) {
  throw new Error("MCP auth is not configured — ensure mcpResourceUrl is set");
}

const auth = baseAuth;
const keeperMcpToolset = createKeeperMcpToolset({
  feedback: {
    deployment: resolveDeployment(env.COMMERCIAL_MODE ?? false),
    version: buildIdentity.VERSION,
  },
});
const handleMcpRequest = createKeeperMcpHandler({
  auth,
  mcpPublicUrl: env.MCP_PUBLIC_URL,
  apiBaseUrl: resolveApiBaseUrl(env),
  toolset: keeperMcpToolset,
  isAgentFeedbackEnabled: createAgentFeedbackAvailability({
    instanceDisabled: env.AGENT_FEEDBACK_DISABLED ?? false,
    readUserPreference: (userId) => readUserAgentFeedbackEnabled(database, userId),
  }),
});

export { auth, database, env, handleMcpRequest, keeperMcpToolset, withWideEvent };
