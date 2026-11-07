import { KEEPER_API_READ_SCOPE } from "@keeper.sh/auth";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult, Implementation } from "@modelcontextprotocol/sdk/types.js";
import { isDiscoveryPayload, isSignInPromptingPayload } from "./discovery";
import { resolveToolScopes, resolveToolSecuritySchemes } from "./security-schemes";
import { createSignInChallengeToolResult } from "./sign-in-challenge";
import type { SignInChallengeReason } from "./sign-in-challenge";
import { expectsToolResultSignIn } from "./tool-result-sign-in";
import { KEEPER_MCP_SERVER_INFO } from "./server-identity";
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

type SignedOutReason = "missing_token" | "invalid_token" | "insufficient_scope";

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
  bearerToken: string,
): Promise<McpSessionResolution> => {
  try {
    const session = await auth.api.getMcpSession({ headers });

    if (!session?.userId) {
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

const stringifyToolResult = (result: unknown): string => JSON.stringify(result, null, 2);

const createToolResponse = (result: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: stringifyToolResult(result),
    },
  ],
});

type ToolExecutor = (
  name: string,
  tool: KeeperMcpToolDefinition<unknown>,
  input: Record<string, unknown>,
) => Promise<CallToolResult>;

const createUserToolExecutor = (
  toolContext: KeeperToolContext,
  userId: string,
): ToolExecutor => async (name, tool, input) => {
  widelog.set("mcp.tool", name);
  widelog.set("user.id", userId);
  return createToolResponse(await tool.execute(toolContext, input));
};

const toSignInChallengeReason = (reason: SignedOutReason): SignInChallengeReason => {
  if (reason === "insufficient_scope") {
    return "insufficient_scope";
  }

  return "invalid_token";
};

const createSignInChallengeExecutor = (
  resourceMetadataUrl: string,
  reason: SignedOutReason,
): ToolExecutor => (name, tool) => {
  widelog.set("mcp.tool", name);
  widelog.set("mcp.sign_in_challenge", reason);
  return Promise.resolve(createSignInChallengeToolResult({
    reason: toSignInChallengeReason(reason),
    resourceMetadataUrl,
    scopes: resolveToolScopes(tool),
  }));
};

const canServeSignedOut = (request: Request, payload: unknown, reason: SignedOutReason): boolean => {
  if (expectsToolResultSignIn(request, payload)) {
    return isSignInPromptingPayload(payload);
  }

  return reason === "missing_token" && isDiscoveryPayload(payload);
};

const createMcpServer = (
  toolset: KeeperMcpToolset,
  serverInfo: Implementation,
  executeTool: ToolExecutor,
): McpServer => {
  const server = new McpServer(serverInfo, {
    capabilities: {
      tools: {},
    },
  });

  const tools: Record<string, KeeperMcpToolDefinition<unknown>> = { ...toolset };

  for (const [name, tool] of Object.entries(tools)) {
    server.registerTool(
      name,
      {
        _meta: { securitySchemes: resolveToolSecuritySchemes(tool) },
        annotations: { ...tool.annotations, title: tool.title },
        description: tool.description,
        inputSchema: tool.inputSchema,
        title: tool.title,
      },
      (input: Record<string, unknown>) => executeTool(name, tool, input),
    );
  }

  return server;
};

const serveWithMcpServer = async (
  server: McpServer,
  request: Request,
  enableJsonResponse: boolean,
  parsedBody?: unknown,
): Promise<Response> => {
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request, { parsedBody });
  } finally {
    await transport.close();
    await server.close();
  }
};

const readJsonRpcPayload = async (request: Request): Promise<unknown> => {
  if (request.method !== "POST") {
    return null;
  }

  try {
    return await request.json();
  } catch {
    return null;
  }
};

const createKeeperMcpHandler = ({
  auth,
  mcpPublicUrl,
  apiBaseUrl,
  toolset,
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

    const insufficientScopeResponse = () => {
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
    };

    const refuseOverHttp = (reason: SignedOutReason): Response => {
      if (reason === "insufficient_scope") {
        return insufficientScopeResponse();
      }

      return unauthorizedResponse();
    };

    const serveSignedOut = async (reason: SignedOutReason): Promise<Response> => {
      const payload = await readJsonRpcPayload(request);

      if (!canServeSignedOut(request, payload, reason)) {
        return refuseOverHttp(reason);
      }

      widelog.set("mcp.signed_out", reason);
      const server = createMcpServer(
        toolset,
        serverInfo,
        createSignInChallengeExecutor(protectedResourceMetadataUrl, reason),
      );
      return serveWithMcpServer(server, request, enableJsonResponse, payload);
    };

    if (!request.headers.has("authorization")) {
      return serveSignedOut("missing_token");
    }

    const bearerToken = extractBearerToken(request.headers);

    if (!bearerToken) {
      return serveSignedOut("invalid_token");
    }

    const sessionResult = await resolveMcpSession(auth, request.headers, bearerToken);

    if (!sessionResult.authenticated) {
      return serveSignedOut("invalid_token");
    }

    const { userId, scopes } = sessionResult.session;

    if (!hasScope(scopes, KEEPER_API_READ_SCOPE)) {
      return serveSignedOut("insufficient_scope");
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

    const server = createMcpServer(
      toolset,
      serverInfo,
      createUserToolExecutor(toolContext, userId),
    );
    return serveWithMcpServer(server, request, enableJsonResponse);
  };
};

export { createKeeperMcpHandler };
export type { CreateKeeperMcpHandlerOptions, KeeperMcpAuth, KeeperMcpAuthSession };
