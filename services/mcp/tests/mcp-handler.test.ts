import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createKeeperMcpHandler } from "../src/mcp-handler";
import { createKeeperMcpToolset } from "../src/toolset";
import { testFeedbackOptions } from "./helpers/feedback-options";

const toolset = createKeeperMcpToolset({ feedback: testFeedbackOptions });

const listedToolSchema = z.object({
  name: z.string(),
  annotations: z.object({
    title: z.string(),
    readOnlyHint: z.boolean(),
    destructiveHint: z.boolean(),
    openWorldHint: z.boolean(),
  }),
});

const listToolsResultSchema = z.object({
  result: z.object({
    tools: z.array(listedToolSchema),
  }),
});

describe("createKeeperMcpHandler", () => {
  it("returns protected-resource metadata when authentication is missing", async () => {
    const handler = createKeeperMcpHandler({
      auth: {
        api: {
          getMcpSession: () => Promise.resolve(null),
        },
      },
      mcpPublicUrl: "https://mcp.keeper.sh",
      apiBaseUrl: "https://keeper.sh",
      toolset,
    });

    const response = await handler(
      new Request("https://mcp.keeper.sh/mcp", {
        body: JSON.stringify({
          id: "1",
          jsonrpc: "2.0",
          method: "tools/list",
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      'resource_metadata="https://mcp.keeper.sh/.well-known/oauth-protected-resource"',
    );
  });

  it("supports unauthenticated GET with an OAuth challenge instead of 405", async () => {
    const handler = createKeeperMcpHandler({
      auth: {
        api: {
          getMcpSession: () => Promise.resolve(null),
        },
      },
      mcpPublicUrl: "https://mcp.keeper.sh",
      apiBaseUrl: "https://keeper.sh",
      toolset,
    });

    const response = await handler(
      new Request("https://mcp.keeper.sh/mcp", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      'resource_metadata="https://mcp.keeper.sh/.well-known/oauth-protected-resource"',
    );
  });

  it("returns insufficient scope metadata when keeper.read is missing", async () => {
    const handler = createKeeperMcpHandler({
      auth: {
        api: {
          getMcpSession: () => Promise.resolve({
            scopes: "openid profile",
            userId: "user-123",
          }),
        },
      },
      mcpPublicUrl: "https://mcp.keeper.sh",
      apiBaseUrl: "https://keeper.sh",
      toolset,
    });

    const response = await handler(
      new Request("https://mcp.keeper.sh/mcp", {
        body: JSON.stringify({
          id: "1",
          jsonrpc: "2.0",
          method: "tools/list",
        }),
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer test-token",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toContain('error="insufficient_scope"');
    expect(response.headers.get("WWW-Authenticate")).toContain('scope="keeper.read"');
  });

  it("returns unauthorized challenge when token verification throws", async () => {
    const authValidationError = new Error("invalid token");
    authValidationError.name = "APIError";

    const handler = createKeeperMcpHandler({
      auth: {
        api: {
          getMcpSession: () => Promise.reject(authValidationError),
        },
      },
      mcpPublicUrl: "https://mcp.keeper.sh",
      apiBaseUrl: "https://keeper.sh",
      toolset,
    });

    const response = await handler(
      new Request("https://mcp.keeper.sh/mcp", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      'resource_metadata="https://mcp.keeper.sh/.well-known/oauth-protected-resource"',
    );
  });

  it("lists every tool with its annotations", async () => {
    const handler = createKeeperMcpHandler({
      auth: {
        api: {
          getMcpSession: () => Promise.resolve({
            scopes: "keeper.read",
            userId: "user-123",
          }),
        },
      },
      mcpPublicUrl: "https://mcp.keeper.sh",
      apiBaseUrl: "https://keeper.sh",
      toolset,
    });

    const response = await handler(
      new Request("https://mcp.keeper.sh/mcp", {
        body: JSON.stringify({
          id: "1",
          jsonrpc: "2.0",
          method: "tools/list",
        }),
        headers: {
          "Accept": "application/json, text/event-stream",
          "Authorization": "Bearer test-token",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    const { result } = listToolsResultSchema.parse(await response.json());
    const annotationsByName = new Map(
      result.tools.map((tool) => [tool.name, tool.annotations]),
    );

    expect(annotationsByName.size).toBe(Object.keys(toolset).length);
    expect(annotationsByName.get("get_events")).toEqual({
      title: "Get events",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(annotationsByName.get("delete_event")).toEqual({
      title: "Delete event",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    });
  });

  it("rejects authenticated GET with 405 because no server-initiated stream is offered", async () => {
    const handler = createKeeperMcpHandler({
      auth: {
        api: {
          getMcpSession: () => Promise.resolve({
            scopes: "keeper.read",
            userId: "user-123",
          }),
        },
      },
      mcpPublicUrl: "https://mcp.keeper.sh",
      apiBaseUrl: "https://keeper.sh",
      toolset,
    });

    const response = await handler(
      new Request("https://mcp.keeper.sh/mcp", {
        headers: {
          "Accept": "text/event-stream",
          "Authorization": "Bearer test-token",
        },
        method: "GET",
      }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST, DELETE, OPTIONS");
  });

  it("rethrows unexpected session errors", async () => {
    const handler = createKeeperMcpHandler({
      auth: {
        api: {
          getMcpSession: () => Promise.reject(new Error("database unavailable")),
        },
      },
      mcpPublicUrl: "https://mcp.keeper.sh",
      apiBaseUrl: "https://keeper.sh",
      toolset,
    });

    await expect(
      handler(
        new Request("https://mcp.keeper.sh/mcp", {
          method: "GET",
        }),
      ),
    ).rejects.toThrow("database unavailable");
  });
});

const callToolResultSchema = z.object({
  result: z.object({
    content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
    isError: z.boolean().optional(),
  }),
});

const initializeInstructionsSchema = z.object({
  result: z.object({ instructions: z.string() }),
});

const createAuthenticatedHandler = () =>
  createKeeperMcpHandler({
    auth: {
      api: {
        getMcpSession: () => Promise.resolve({
          scopes: "keeper.read",
          userId: "user-123",
        }),
      },
    },
    mcpPublicUrl: "https://mcp.keeper.sh",
    apiBaseUrl: "https://keeper.sh",
    toolset,
  });

const sendRpc = (method: string, params: Record<string, unknown>) =>
  createAuthenticatedHandler()(
    new Request("https://mcp.keeper.sh/mcp", {
      body: JSON.stringify({ id: "1", jsonrpc: "2.0", method, params }),
      headers: {
        "Accept": "application/json, text/event-stream",
        "Authorization": "Bearer test-token",
        "Content-Type": "application/json",
      },
      method: "POST",
    }),
  );

const callTool = async (name: string, args: Record<string, unknown>) => {
  const response = await sendRpc("tools/call", { arguments: args, name });
  const { result } = callToolResultSchema.parse(await response.json());
  return { isError: result.isError ?? false, text: result.content.map((part) => part.text).join("") };
};

const stubApiStatus = (status: number, body: unknown) => {
  vi.stubGlobal("fetch", () => Promise.resolve(Response.json(body, { status })));
};

const FEEDBACK_NUDGE = "report it with send_feedback";

describe("agent feedback discoverability", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tells agents about send_feedback in the initialize instructions", async () => {
    const response = await sendRpc("initialize", {
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
      protocolVersion: "2025-11-25",
    });

    const { result } = initializeInstructionsSchema.parse(await response.json());
    expect(result.instructions).toMatch(/^Feedback: /);
    expect(result.instructions).toContain("send_feedback");
    expect(result.instructions).toContain("calendar data");
  });

  it("suggests feedback when the Keeper.sh API fails on its side", async () => {
    stubApiStatus(500, { error: "Internal server error" });

    const { isError, text } = await callTool("list_calendars", {});

    expect(isError).toBe(true);
    expect(text).toContain("Internal server error");
    expect(text).toContain(FEEDBACK_NUDGE);
  });

  it("suggests feedback when a result does not have the shape the tool expects", async () => {
    stubApiStatus(200, { unexpected: true });

    const { isError, text } = await callTool("list_calendars", {});

    expect(isError).toBe(true);
    expect(text).toContain(FEEDBACK_NUDGE);
  });

  it("leaves errors the agent can fix itself without the suggestion", async () => {
    stubApiStatus(404, { error: "Event not found" });

    const { isError, text } = await callTool("get_event", { eventId: "missing" });

    expect(isError).toBe(true);
    expect(text).toContain("Event not found");
    expect(text).not.toContain(FEEDBACK_NUDGE);
  });

  it("leaves input mistakes without the suggestion", async () => {
    const { isError, text } = await callTool("update_calendar_settings", {
      calendarId: "00000000-0000-4000-8000-000000000001",
    });

    expect(isError).toBe(true);
    expect(text).toContain("Provide at least one setting to update");
    expect(text).not.toContain(FEEDBACK_NUDGE);
  });

  it("returns the feedback confirmation as a single plain line", async () => {
    stubApiStatus(201, { received: true });

    const { isError, text } = await callTool("send_feedback", {
      category: "confusing_output",
      message: "find_free_time returned slots outside working hours.",
      toolName: "find_free_time",
    });

    expect(isError).toBe(false);
    expect(text).toBe("Thanks, the Keeper.sh team received your feedback. Carry on with your task.");
  });
});
