import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createKeeperMcpHandler } from "../src/mcp-handler";
import type { KeeperMcpToolset } from "../src/toolset";
import { createKeeperMcpToolset } from "../src/toolset";

const MCP_URL = "https://mcp.keeper.sh/mcp";
const RESOURCE_METADATA_CHALLENGE =
  'Bearer resource_metadata="https://mcp.keeper.sh/.well-known/oauth-protected-resource"';

const createSpiedToolset = () => {
  const toolset = createKeeperMcpToolset();
  const executions = Object.values(toolset).map((tool) => vi.spyOn(tool, "execute"));
  return { toolset, executions };
};

type SessionLookup = () => Promise<{ scopes: string; userId: string } | null>;

const createHandler = (
  toolset: KeeperMcpToolset,
  getMcpSession = vi.fn<SessionLookup>(() =>
    Promise.resolve({ scopes: "keeper.read", userId: "user-123" })),
) => ({
  getMcpSession,
  handler: createKeeperMcpHandler({
    auth: { api: { getMcpSession } },
    mcpPublicUrl: "https://mcp.keeper.sh",
    apiBaseUrl: "https://keeper.sh",
    toolset,
  }),
});

const postJsonRpc = (payload: unknown, headers: Record<string, string> = {}) =>
  new Request(MCP_URL, {
    body: JSON.stringify(payload),
    headers: {
      "Accept": "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...headers,
    },
    method: "POST",
  });

const initializeRequest = {
  id: 1,
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
    protocolVersion: "2025-11-25",
  },
};

const toolsListRequest = { id: 2, jsonrpc: "2.0", method: "tools/list" };

const toolsCallRequest = {
  id: 3,
  jsonrpc: "2.0",
  method: "tools/call",
  params: { name: "list_calendars", arguments: {} },
};

const listedToolsSchema = z.object({
  result: z.object({
    tools: z.array(z.object({ name: z.string(), description: z.string() })),
  }),
});

const securedToolsSchema = z.object({
  result: z.object({
    tools: z.array(z.object({
      name: z.string(),
      _meta: z.object({
        securitySchemes: z.array(z.object({ type: z.string(), scopes: z.array(z.string()) })),
      }),
    })),
  }),
});

const initializeResultSchema = z.object({
  result: z.object({
    capabilities: z.object({ tools: z.object({}) }),
    serverInfo: z.object({ name: z.string(), version: z.string() }),
  }),
});

const expectAuthChallenge = (response: Response) => {
  expect(response.status).toBe(401);
  expect(response.headers.get("WWW-Authenticate")).toBe(RESOURCE_METADATA_CHALLENGE);
};

describe("anonymous discovery", () => {
  it("initializes without a token, never consulting the session store", async () => {
    const { toolset } = createSpiedToolset();
    const { handler, getMcpSession } = createHandler(toolset);

    const response = await handler(postJsonRpc(initializeRequest));

    expect(response.status).toBe(200);
    expect(initializeResultSchema.parse(await response.json()).result.capabilities.tools).toEqual({});
    expect(getMcpSession).not.toHaveBeenCalled();
  });

  it("accepts the initialized notification without a token", async () => {
    const { toolset } = createSpiedToolset();
    const { handler } = createHandler(toolset);

    const response = await handler(
      postJsonRpc({ jsonrpc: "2.0", method: "notifications/initialized" }),
    );

    expect(response.status).toBe(202);
  });

  it("lists the same tools without a token as with one", async () => {
    const { toolset, executions } = createSpiedToolset();
    const { handler } = createHandler(toolset);

    const anonymousResponse = await handler(postJsonRpc(toolsListRequest));
    const authenticatedResponse = await handler(
      postJsonRpc(toolsListRequest, { Authorization: "Bearer test-token" }),
    );
    const anonymous = listedToolsSchema.parse(await anonymousResponse.json());
    const authenticated = listedToolsSchema.parse(await authenticatedResponse.json());

    expect(anonymous.result.tools.length).toBe(Object.keys(toolset).length);
    expect(anonymous.result.tools).toEqual(authenticated.result.tools);
    for (const execution of executions) {
      expect(execution).not.toHaveBeenCalled();
    }
  });

  it("declares each tool's OAuth scopes in its metadata without a token", async () => {
    const { toolset } = createSpiedToolset();
    const { handler } = createHandler(toolset);

    const response = await handler(postJsonRpc(toolsListRequest));
    const { result } = securedToolsSchema.parse(await response.json());
    const schemesByName = new Map(
      result.tools.map((tool) => [tool.name, tool._meta.securitySchemes]),
    );

    expect(schemesByName.size).toBe(Object.keys(toolset).length);
    expect(schemesByName.get("get_events")).toEqual([
      { type: "oauth2", scopes: ["keeper.read"] },
    ]);
    expect(schemesByName.get("delete_event")).toEqual([
      { type: "oauth2", scopes: ["keeper.read", "keeper.write"] },
    ]);
  });

  it("challenges a tool call without a token before any tool runs", async () => {
    const { toolset, executions } = createSpiedToolset();
    const { handler } = createHandler(toolset);

    const response = await handler(postJsonRpc(toolsCallRequest));

    expectAuthChallenge(response);
    for (const execution of executions) {
      expect(execution).not.toHaveBeenCalled();
    }
  });

  it("challenges a batch that smuggles a tool call alongside discovery", async () => {
    const { toolset, executions } = createSpiedToolset();
    const { handler } = createHandler(toolset);

    const response = await handler(postJsonRpc([toolsListRequest, toolsCallRequest]));

    expectAuthChallenge(response);
    for (const execution of executions) {
      expect(execution).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["resources/list", { id: 4, jsonrpc: "2.0", method: "resources/list" }],
    ["prompts/list", { id: 5, jsonrpc: "2.0", method: "prompts/list" }],
    ["a response message", { id: 6, jsonrpc: "2.0", result: {} }],
    ["an empty batch", []],
  ])("challenges %s without a token", async (_label, payload) => {
    const { toolset } = createSpiedToolset();
    const { handler } = createHandler(toolset);

    expectAuthChallenge(await handler(postJsonRpc(payload)));
  });

  it("challenges a body that is not JSON", async () => {
    const { toolset } = createSpiedToolset();
    const { handler } = createHandler(toolset);

    const response = await handler(
      new Request(MCP_URL, {
        body: "not json",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expectAuthChallenge(response);
  });

  it("still rejects an invalid token on a discovery method so the client refreshes it", async () => {
    const { toolset } = createSpiedToolset();
    const { handler } = createHandler(toolset, vi.fn<SessionLookup>(() => Promise.resolve(null)));

    expectAuthChallenge(
      await handler(postJsonRpc(toolsListRequest, { Authorization: "Bearer expired-token" })),
    );
  });

  it("serves a token-bearing tool call after an anonymous initialize, with no session to carry over", async () => {
    const { toolset } = createSpiedToolset();
    const listCalendars = vi.spyOn(toolset.list_calendars, "execute").mockResolvedValue([]);
    const { handler } = createHandler(toolset);

    const initialize = await handler(postJsonRpc(initializeRequest));
    expect(initialize.headers.get("Mcp-Session-Id")).toBeNull();

    expectAuthChallenge(await handler(postJsonRpc(toolsCallRequest)));

    const response = await handler(postJsonRpc(toolsCallRequest, { Authorization: "Bearer test-token" }));

    expect(response.status).toBe(200);
    expect(listCalendars).toHaveBeenCalledOnce();
    expect(listCalendars.mock.calls[0]?.[0]).toEqual({
      apiBaseUrl: "https://keeper.sh",
      bearerToken: "test-token",
    });
  });
});
