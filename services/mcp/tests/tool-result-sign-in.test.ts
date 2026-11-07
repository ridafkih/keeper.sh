import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createKeeperMcpHandler } from "../src/mcp-handler";
import type { KeeperMcpToolset } from "../src/toolset";
import { createKeeperMcpToolset } from "../src/toolset";

const MCP_URL = "https://mcp.keeper.sh/mcp";
const RESOURCE_METADATA = 'resource_metadata="https://mcp.keeper.sh/.well-known/oauth-protected-resource"';
const CHATGPT_USER_AGENT = "openai-mcp/1.0.0";

type SessionLookup = () => Promise<{ scopes: string; userId: string } | null>;

const createSpiedToolset = () => {
  const toolset = createKeeperMcpToolset();
  const executions = Object.values(toolset).map((tool) => vi.spyOn(tool, "execute"));
  return { toolset, executions };
};

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

const createToolsCall = (
  name: string,
  { input = {}, meta }: { input?: Record<string, unknown>; meta?: Record<string, unknown> } = {},
) => ({
  id: 3,
  jsonrpc: "2.0",
  method: "tools/call",
  params: { name, arguments: input, ...(meta && { _meta: meta }) },
});

const listCalendarsCall = createToolsCall("list_calendars");
const toolsListRequest = { id: 2, jsonrpc: "2.0", method: "tools/list" };
const fromChatGpt = { "User-Agent": CHATGPT_USER_AGENT };

const signInChallengeSchema = z.object({
  result: z.object({
    content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
    isError: z.literal(true),
    _meta: z.object({ "mcp/www_authenticate": z.array(z.string()).length(1) }),
  }),
});

const toolsListSchema = z.object({
  result: z.object({ tools: z.array(z.object({ name: z.string() })) }),
});

const readSignInChallenge = async (response: Response): Promise<string> => {
  expect(response.status).toBe(200);
  const { result } = signInChallengeSchema.parse(await response.json());
  const [challenge] = result._meta["mcp/www_authenticate"];
  return challenge ?? "";
};

const expectNoToolRan = (executions: ReturnType<typeof createSpiedToolset>["executions"]) => {
  for (const execution of executions) {
    expect(execution).not.toHaveBeenCalled();
  }
};

describe("tool-result sign-in for ChatGPT", () => {
  it("answers a tool call without a token with an in-band sign-in challenge", async () => {
    const { toolset, executions } = createSpiedToolset();
    const { handler, getMcpSession } = createHandler(toolset);

    const challenge = await readSignInChallenge(
      await handler(postJsonRpc(listCalendarsCall, fromChatGpt)),
    );

    expect(challenge).toContain(RESOURCE_METADATA);
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toMatch(/error_description="[^"]+"/);
    expect(challenge).toContain('scope="keeper.read"');
    expect(getMcpSession).not.toHaveBeenCalled();
    expectNoToolRan(executions);
  });

  it("recognises ChatGPT by the openai request metadata when the user agent says nothing", async () => {
    const { toolset, executions } = createSpiedToolset();
    const { handler } = createHandler(toolset);

    const challenge = await readSignInChallenge(
      await handler(postJsonRpc(createToolsCall("list_calendars", {
        meta: { "openai/locale": "en-US", "openai/subject": "anonymous-subject" },
      }))),
    );

    expect(challenge).toContain('error="invalid_token"');
    expectNoToolRan(executions);
  });

  it("asks for write access when the tool changes data", async () => {
    const { toolset } = createSpiedToolset();
    const { handler } = createHandler(toolset);

    const challenge = await readSignInChallenge(
      await handler(postJsonRpc(createToolsCall("delete_event", { input: { eventId: "event-1" } }), fromChatGpt)),
    );

    expect(challenge).toContain('scope="keeper.read keeper.write"');
  });

  it.each([
    ["an expired token", vi.fn<SessionLookup>(() => Promise.resolve(null))],
    [
      "a token the session store rejects",
      vi.fn<SessionLookup>(() => Promise.reject(Object.assign(new Error("invalid"), { name: "APIError" }))),
    ],
  ])("challenges a tool call carrying %s the same way", async (_label, getMcpSession) => {
    const { toolset, executions } = createSpiedToolset();
    const { handler } = createHandler(toolset, getMcpSession);

    const challenge = await readSignInChallenge(
      await handler(postJsonRpc(listCalendarsCall, { ...fromChatGpt, Authorization: "Bearer expired-token" })),
    );

    expect(challenge).toContain('error="invalid_token"');
    expectNoToolRan(executions);
  });

  it("challenges a malformed authorization header the same way", async () => {
    const { toolset } = createSpiedToolset();
    const { handler } = createHandler(toolset);

    const challenge = await readSignInChallenge(
      await handler(postJsonRpc(listCalendarsCall, { ...fromChatGpt, Authorization: "Basic abc" })),
    );

    expect(challenge).toContain('error="invalid_token"');
  });

  it("keeps listing tools with an expired token so the connector stays usable", async () => {
    const { toolset } = createSpiedToolset();
    const { handler } = createHandler(toolset, vi.fn<SessionLookup>(() => Promise.resolve(null)));

    const response = await handler(
      postJsonRpc(toolsListRequest, { ...fromChatGpt, Authorization: "Bearer expired-token" }),
    );

    expect(response.status).toBe(200);
    expect(toolsListSchema.parse(await response.json()).result.tools.length).toBe(Object.keys(toolset).length);
  });

  it("asks for more access when the token lacks keeper.read", async () => {
    const { toolset, executions } = createSpiedToolset();
    const { handler } = createHandler(
      toolset,
      vi.fn<SessionLookup>(() => Promise.resolve({ scopes: "openid profile", userId: "user-123" })),
    );

    const challenge = await readSignInChallenge(
      await handler(postJsonRpc(listCalendarsCall, { ...fromChatGpt, Authorization: "Bearer narrow-token" })),
    );

    expect(challenge).toContain('error="insufficient_scope"');
    expectNoToolRan(executions);
  });

  it("challenges every tool call in a batch", async () => {
    const { toolset, executions } = createSpiedToolset();
    const { handler } = createHandler(toolset);

    const response = await handler(postJsonRpc([toolsListRequest, listCalendarsCall], fromChatGpt));

    expect(response.status).toBe(200);
    const [listed, called] = z.tuple([toolsListSchema, signInChallengeSchema]).parse(await response.json());
    expect(listed.result.tools.length).toBe(Object.keys(toolset).length);
    expect(called.result.isError).toBe(true);
    expectNoToolRan(executions);
  });

  it("still refuses other methods over HTTP", async () => {
    const { toolset } = createSpiedToolset();
    const { handler } = createHandler(toolset);

    const response = await handler(
      postJsonRpc({ id: 4, jsonrpc: "2.0", method: "resources/list" }, fromChatGpt),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(RESOURCE_METADATA);
  });

  it("runs the tool once ChatGPT signs in", async () => {
    const { toolset } = createSpiedToolset();
    const listCalendars = vi.spyOn(toolset.list_calendars, "execute").mockResolvedValue([]);
    const { handler } = createHandler(toolset);

    const response = await handler(
      postJsonRpc(listCalendarsCall, { ...fromChatGpt, Authorization: "Bearer test-token" }),
    );

    expect(response.status).toBe(200);
    expect(z.object({ result: z.object({ isError: z.undefined() }) }).parse(await response.json())).toBeTruthy();
    expect(listCalendars).toHaveBeenCalledOnce();
  });
});

describe("HTTP sign-in for Claude and other spec clients", () => {
  it.each([
    ["Claude", { "User-Agent": "Claude-User" }],
    ["the MCP SDK", { "User-Agent": "node" }],
    ["no user agent", {}],
  ])("answers a tool call without a token from %s with a 401", async (_label, headers) => {
    const { toolset, executions } = createSpiedToolset();
    const { handler } = createHandler(toolset);

    const response = await handler(postJsonRpc(listCalendarsCall, headers));

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(RESOURCE_METADATA);
    expectNoToolRan(executions);
  });

  it("answers an expired token from Claude with a 401 so it refreshes", async () => {
    const { toolset } = createSpiedToolset();
    const { handler } = createHandler(toolset, vi.fn<SessionLookup>(() => Promise.resolve(null)));

    const response = await handler(
      postJsonRpc(listCalendarsCall, { "User-Agent": "Claude-User", Authorization: "Bearer expired-token" }),
    );

    expect(response.status).toBe(401);
  });

  it("answers a token without keeper.read from Claude with a 403", async () => {
    const { toolset } = createSpiedToolset();
    const { handler } = createHandler(
      toolset,
      vi.fn<SessionLookup>(() => Promise.resolve({ scopes: "openid profile", userId: "user-123" })),
    );

    const response = await handler(
      postJsonRpc(listCalendarsCall, { "User-Agent": "Claude-User", Authorization: "Bearer narrow-token" }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toContain('error="insufficient_scope"');
  });
});
