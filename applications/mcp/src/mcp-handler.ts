import { KEEPER_API_READ_SCOPE } from "@keeper.sh/auth";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { widelog } from "./utils/logging";
import type { KeeperMcpToolDefinition, KeeperMcpToolset } from "./toolset";

const JSON_RPC_VERSION = "2.0";
const JSON_RPC_ERROR_UNAUTHORIZED = -32_001;
const JSON_RPC_ERROR_FORBIDDEN = -32_003;
const JSON_RPC_ERROR_METHOD_NOT_ALLOWED = -32_005;
const ALLOWED_HTTP_METHODS = new Set(["DELETE", "GET", "POST"]);
const ALLOW_HEADER_VALUE = "GET, POST, DELETE, OPTIONS";
type ResponseHeaders = Headers | Record<string, string>;

interface KeeperMcpAuthSession {
  scopes: string;
  userId: string | null;
}

interface KeeperMcpAuth {
  api: {
    getMcpSession: (input: { headers: Headers }) => Promise<KeeperMcpAuthSession | null>;
  };
}

interface CreateKeeperMcpHandlerOptions {
  auth: KeeperMcpAuth;
  mcpPublicUrl: string;
  toolset: KeeperMcpToolset;
  serverInfo?: {
    name: string;
    version: string;
  };
  enableJsonResponse?: boolean;
}

const hasScope = (scopes: string, requiredScope: string): boolean =>
  scopes
    .split(/\s+/)
    .filter((scope) => scope.length > 0)
    .includes(requiredScope);

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

const registerToolset = (
  server: McpServer,
  toolset: Record<string, KeeperMcpToolDefinition<unknown>>,
  userId: string,
): void => {
  for (const [name, tool] of Object.entries(toolset)) {
    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        title: tool.title,
      },
      (input: Record<string, unknown>) =>
        widelog.context(async () => {
          widelog.set("operation.name", `mcp:tool:${name}`);
          widelog.set("operation.type", "mcp");
          widelog.set("mcp.tool", name);
          widelog.set("user.id", userId);
          widelog.time.start("duration_ms");

          try {
            const result = await tool.execute({ userId }, input);
            widelog.set("outcome", "success");
            return createToolResponse(result);
          } catch (error) {
            widelog.set("outcome", "error");
            widelog.errorFields(error);
            throw error;
          } finally {
            widelog.time.stop("duration_ms");
            widelog.flush();
          }
        }),
    );
  }
};

const createAuthenticatedMcpServer = (
  toolset: KeeperMcpToolset,
  userId: string,
  serverInfo: { name: string; version: string },
): McpServer => {
  const server = new McpServer(serverInfo, {
    capabilities: {
      tools: {},
    },
  });

  const tools: Record<string, KeeperMcpToolDefinition<unknown>> = { ...toolset };
  registerToolset(server, tools, userId);

  return server;
};

const createKeeperMcpHandler = ({
  auth,
  mcpPublicUrl,
  toolset,
  serverInfo = {
    name: "keeper",
    version: "1.0.0",
  },
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

    const sessionResult = await auth.api
      .getMcpSession({ headers: request.headers });

    const userId = sessionResult?.userId;
    if (!userId) {
      return unauthorizedResponse();
    }

    if (!hasScope(sessionResult.scopes, KEEPER_API_READ_SCOPE)) {
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

    const server = createAuthenticatedMcpServer(toolset, userId, serverInfo);
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
