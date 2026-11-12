import { KEEPER_API_READ_SCOPE } from "@keeper.sh/auth";
import { MAX_AGENT_INTENT_LENGTH } from "@keeper.sh/data-schemas";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { KEEPER_MCP_INSTRUCTIONS, KEEPER_MCP_SERVER_INFO } from "./server-identity";
import { isExpectedToolFailure } from "./tool-api";
import type { KeeperToolCall } from "./tool-api";
import type { KeeperMcpToolDefinition, KeeperMcpToolset, KeeperToolContext } from "./toolset";
import { widelog } from "./utils/logging";

const JSON_RPC_VERSION = "2.0";
const JSON_RPC_ERROR_UNAUTHORIZED = -32_001;
const JSON_RPC_ERROR_FORBIDDEN = -32_003;
const JSON_RPC_ERROR_METHOD_NOT_ALLOWED = -32_005;
const ALLOWED_HTTP_METHODS = new Set(["DELETE", "GET", "POST"]);
const ALLOW_HEADER_VALUE = "POST, DELETE, OPTIONS";
type ResponseHeaders = Headers | Record<string, string>;

interface KeeperMcpAuthSession {
  scopes: string;
  userId: string | null;
}

interface AuthenticatedKeeperMcpSession {
  scopes: string;
  userId: string;
  bearerToken: string;
}

interface KeeperMcpAuth {
  api: {
    getMcpSession: (input: { headers: Headers }) => Promise<KeeperMcpAuthSession | null>;
  };
}

type McpSessionResolution =
  | {
    authenticated: true;
    session: AuthenticatedKeeperMcpSession;
  }
  | {
    authenticated: false;
  };

interface CreateKeeperMcpHandlerOptions {
  auth: KeeperMcpAuth;
  mcpPublicUrl: string;
  apiBaseUrl: string;
  toolset: KeeperMcpToolset;
  isAgentFeedbackEnabled: (userId: string) => Promise<boolean>;
  serverInfo?: Implementation;
  enableJsonResponse?: boolean;
}

const hasScope = (scopes: string, requiredScope: string): boolean =>
  scopes
    .split(/\s+/)
    .filter((scope) => scope.length > 0)
    .includes(requiredScope);

const isAuthValidationError = (error: unknown): boolean =>
  error instanceof Error && error.name === "APIError";

const extractBearerToken = (headers: Headers): string | null => {
  const authHeader = headers.get("authorization");
  if (!authHeader) {
    return null;
  }

  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  return authHeader.slice("Bearer ".length);
};

const resolveMcpSession = async (
  auth: KeeperMcpAuth,
  headers: Headers,
): Promise<McpSessionResolution> => {
  try {
    const session = await auth.api.getMcpSession({ headers });

    if (!session?.userId) {
      return { authenticated: false };
    }

    const bearerToken = extractBearerToken(headers);

    if (!bearerToken) {
      return { authenticated: false };
    }

    const authenticatedSession: AuthenticatedKeeperMcpSession = {
      scopes: session.scopes,
      userId: session.userId,
      bearerToken,
    };

    return {
      authenticated: true,
      session: authenticatedSession,
    };
  } catch (error) {
    if (isAuthValidationError(error)) {
      return { authenticated: false };
    }

    throw error;
  }
};

const createJsonRpcErrorResponse = (
  status: number,
  code: number,
  message: string,
  headers?: ResponseHeaders,
  details?: Record<string, unknown>,
): Response =>
  Response.json(
    {
      jsonrpc: JSON_RPC_VERSION,
      error: {
        code,
        message,
        ...(details && details),
      },
      id: null,
    },
    {
      status,
      headers,
    },
  );

const intentSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_AGENT_INTENT_LENGTH)
  .optional()
  .describe("Optional: your high-level goal for this call, in a sentence");

const separateIntent = (
  input: Record<string, unknown>,
): { toolInput: Record<string, unknown>; call: KeeperToolCall } => {
  const { intent, ...toolInput } = input;
  if (typeof intent === "string") {
    return { call: { intent }, toolInput };
  }
  return { call: {}, toolInput };
};

const FEEDBACK_TOOL_NAME = "send_feedback";
const FEEDBACK_NUDGE =
  `If this looks like a problem with Keeper.sh rather than your input, report it with ${FEEDBACK_TOOL_NAME}.`;

const stringifyToolResult = (result: unknown): string => {
  if (typeof result === "string") {
    return result;
  }
  return JSON.stringify(result, null, 2);
};

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const withFeedbackNudge = (toolName: string, error: unknown): unknown => {
  if (toolName === FEEDBACK_TOOL_NAME || isExpectedToolFailure(error)) {
    return error;
  }
  return new Error(`${describeError(error)} ${FEEDBACK_NUDGE}`, { cause: error });
};

const createToolResponse = (result: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: stringifyToolResult(result),
    },
  ],
});

interface KeeperMcpSession {
  toolContext: KeeperToolContext;
  userId: string;
  agentFeedbackEnabled: boolean;
}

const registerToolset = (
  server: McpServer,
  toolset: Record<string, KeeperMcpToolDefinition<unknown>>,
  { toolContext, userId, agentFeedbackEnabled }: KeeperMcpSession,
): void => {
  for (const [name, tool] of Object.entries(toolset)) {
    const registeredTool = server.registerTool(
      name,
      {
        annotations: { ...tool.annotations, title: tool.title },
        description: tool.description,
        inputSchema: { ...tool.inputSchema, intent: intentSchema },
        title: tool.title,
      },
      async (input: Record<string, unknown>) => {
        widelog.set("mcp.tool", name);
        widelog.set("user.id", userId);
        const { toolInput, call } = separateIntent(input);
        if (!agentFeedbackEnabled) {
          return createToolResponse(await tool.execute(toolContext, toolInput));
        }
        if (call.intent) {
          widelog.set("mcp.intent", call.intent);
        }
        try {
          const result = await tool.execute(toolContext, toolInput, call);
          return createToolResponse(result);
        } catch (error) {
          throw withFeedbackNudge(name, error);
        }
      },
    );
    if (name === FEEDBACK_TOOL_NAME && !agentFeedbackEnabled) {
      registeredTool.disable();
    }
  }
};

const createAuthenticatedMcpServer = (
  toolset: KeeperMcpToolset,
  session: KeeperMcpSession,
  serverInfo: Implementation,
): McpServer => {
  const server = new McpServer(serverInfo, {
    capabilities: {
      tools: {},
    },
    ...(session.agentFeedbackEnabled && { instructions: KEEPER_MCP_INSTRUCTIONS }),
  });

  const tools: Record<string, KeeperMcpToolDefinition<unknown>> = { ...toolset };
  registerToolset(server, tools, session);

  return server;
};

const createKeeperMcpHandler = ({
  auth,
  mcpPublicUrl,
  apiBaseUrl,
  toolset,
  isAgentFeedbackEnabled,
  serverInfo = KEEPER_MCP_SERVER_INFO,
  enableJsonResponse = true,
}: CreateKeeperMcpHandlerOptions) => {
  const protectedResourceMetadataUrl = new URL(
    "/.well-known/oauth-protected-resource",
    mcpPublicUrl,
  ).toString();

  return async (request: Request): Promise<Response> => {
    if (!ALLOWED_HTTP_METHODS.has(request.method)) {
      return createJsonRpcErrorResponse(
        405,
        JSON_RPC_ERROR_METHOD_NOT_ALLOWED,
        "Method not allowed",
        {
          Allow: ALLOW_HEADER_VALUE,
        },
      );
    }

    const wwwAuthenticateHeader = `Bearer resource_metadata="${protectedResourceMetadataUrl}"`;

    const unauthorizedResponse = () =>
      createJsonRpcErrorResponse(
        401,
        JSON_RPC_ERROR_UNAUTHORIZED,
        "Unauthorized: Authentication required",
        {
          "Access-Control-Expose-Headers": "WWW-Authenticate",
          "WWW-Authenticate": wwwAuthenticateHeader,
          Allow: ALLOW_HEADER_VALUE,
        },
        {
          "www-authenticate": wwwAuthenticateHeader,
        },
      );

    const sessionResult = await resolveMcpSession(auth, request.headers);

    if (!sessionResult.authenticated) {
      return unauthorizedResponse();
    }

    const { userId, scopes, bearerToken } = sessionResult.session;

    if (!hasScope(scopes, KEEPER_API_READ_SCOPE)) {
      const insufficientScopeHeader =
        `${wwwAuthenticateHeader}, error="insufficient_scope", scope="${KEEPER_API_READ_SCOPE}"`;

      return createJsonRpcErrorResponse(
        403,
        JSON_RPC_ERROR_FORBIDDEN,
        "Forbidden: keeper.read scope is required",
        {
          "Access-Control-Expose-Headers": "WWW-Authenticate",
          "WWW-Authenticate": insufficientScopeHeader,
          Allow: ALLOW_HEADER_VALUE,
        },
        {
          "www-authenticate": insufficientScopeHeader,
        },
      );
    }

    if (request.method === "GET") {
      return createJsonRpcErrorResponse(
        405,
        JSON_RPC_ERROR_METHOD_NOT_ALLOWED,
        "Method not allowed: this server does not offer a server-initiated stream",
        {
          Allow: ALLOW_HEADER_VALUE,
        },
      );
    }

    const toolContext: KeeperToolContext = {
      bearerToken,
      apiBaseUrl,
    };

    const agentFeedbackEnabled = await isAgentFeedbackEnabled(userId);
    const server = createAuthenticatedMcpServer(
      toolset,
      { agentFeedbackEnabled, toolContext, userId },
      serverInfo,
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse,
    });

    try {
      await server.connect(transport);
      return await transport.handleRequest(request);
    } finally {
      await transport.close();
      await server.close();
    }
  };
};

export { createKeeperMcpHandler };
export type { CreateKeeperMcpHandlerOptions, KeeperMcpAuth, KeeperMcpAuthSession };
