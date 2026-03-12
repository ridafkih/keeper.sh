import { KEEPER_MCP_READ_SCOPE } from "@keeper.sh/auth";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type {
  KeeperMcpEventRangeInput,
  KeeperMcpToolDefinition,
  KeeperMcpToolset,
} from "./toolset";

const JSON_RPC_VERSION = "2.0";
const JSON_RPC_ERROR_UNAUTHORIZED = -32001;
const JSON_RPC_ERROR_FORBIDDEN = -32003;
const JSON_RPC_ERROR_METHOD_NOT_ALLOWED = -32005;
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

const registerZeroInputTool = <TResult>(
  server: McpServer,
  toolName: string,
  tool: KeeperMcpToolDefinition<TResult>,
  userId: string,
): void => {
  server.registerTool(
    toolName,
    {
      description: tool.description,
      inputSchema: tool.inputSchema,
      title: tool.title,
    },
    async () => {
      const result = await tool.execute({ userId });

      return createToolResponse(result);
    },
  );
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

  registerZeroInputTool(server, "list_sources", toolset.list_sources, userId);
  registerZeroInputTool(server, "list_destinations", toolset.list_destinations, userId);
  registerZeroInputTool(server, "list_mappings", toolset.list_mappings, userId);
  registerZeroInputTool(server, "get_sync_status", toolset.get_sync_status, userId);
  registerZeroInputTool(server, "get_event_count", toolset.get_event_count, userId);
  server.registerTool(
    "get_events_range",
    {
      description: toolset.get_events_range.description,
      inputSchema: toolset.get_events_range.inputSchema,
      title: toolset.get_events_range.title,
    },
    async (input) => {
      const result = await toolset.get_events_range.execute(
        { userId },
        input as unknown as KeeperMcpEventRangeInput,
      );

      return createToolResponse(result);
    },
  );

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

    const session = await auth.api.getMcpSession({
      headers: request.headers,
    });

    const wwwAuthenticateHeader = `Bearer resource_metadata="${protectedResourceMetadataUrl}"`;

    if (!session?.userId) {
      return createJsonRpcErrorResponse(
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
    }

    if (!hasScope(session.scopes, KEEPER_MCP_READ_SCOPE)) {
      const insufficientScopeHeader =
        `${wwwAuthenticateHeader}, error="insufficient_scope", scope="${KEEPER_MCP_READ_SCOPE}"`;

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

    const server = createAuthenticatedMcpServer(toolset, session.userId, serverInfo);
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse,
      sessionIdGenerator: undefined,
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
