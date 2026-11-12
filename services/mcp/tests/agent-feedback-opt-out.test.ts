import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgentFeedbackAvailability } from "../src/agent-feedback-availability";
import { createKeeperMcpHandler } from "../src/mcp-handler";
import { createKeeperMcpToolset } from "../src/toolset";
import { AGENT_FEEDBACK_URL } from "../src/tools/feedback-tools";
import { testFeedbackOptions } from "./helpers/feedback-options";

const loggedFields = new Map<string, unknown>();

vi.mock("../src/utils/logging", () => ({
  widelog: { set: (key: string, value: unknown) => loggedFields.set(key, value) },
}));

const toolset = createKeeperMcpToolset({ feedback: testFeedbackOptions });

const INTENT = "Book the user's dentist appointment";

const createHandler = (isAgentFeedbackEnabled: (userId: string) => Promise<boolean>) =>
  createKeeperMcpHandler({
    auth: {
      api: {
        getMcpSession: () => Promise.resolve({ scopes: "keeper.read", userId: "user-123" }),
      },
    },
    mcpPublicUrl: "https://mcp.keeper.sh",
    apiBaseUrl: "https://keeper.example.com",
    toolset,
    isAgentFeedbackEnabled,
  });

const optedOut = createHandler(() => Promise.resolve(false));

const sendRpc = async (
  handler: ReturnType<typeof createHandler>,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> => {
  const response = await handler(
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
  return response.json();
};

const callToolResultSchema = z.object({
  result: z.object({
    content: z.array(z.object({ text: z.string() })),
    isError: z.boolean().optional(),
  }),
});

const callTool = async (handler: ReturnType<typeof createHandler>, name: string, args: Record<string, unknown>) => {
  const { result } = callToolResultSchema.parse(await sendRpc(handler, "tools/call", { arguments: args, name }));
  return { isError: result.isError ?? false, text: result.content.map(({ text }) => text).join("") };
};

const listedToolNamesSchema = z.object({
  result: z.object({ tools: z.array(z.object({ name: z.string() })) }),
});

const listToolNames = async (handler: ReturnType<typeof createHandler>) => {
  const { result } = listedToolNamesSchema.parse(await sendRpc(handler, "tools/list", {}));
  return result.tools.map(({ name }) => name);
};

const initializeResultSchema = z.object({
  result: z.object({ instructions: z.string().optional() }),
});

const initialize = async (handler: ReturnType<typeof createHandler>) => {
  const { result } = initializeResultSchema.parse(await sendRpc(handler, "initialize", {
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
    protocolVersion: "2025-11-25",
  }));
  return result;
};

interface CapturedRequest {
  url: string;
  body: string;
}

const stubFetch = (payload: unknown, status = 200): CapturedRequest[] => {
  const requests: CapturedRequest[] = [];
  vi.stubGlobal("fetch", (url: string, options?: RequestInit) => {
    requests.push({ body: String(options?.body ?? ""), url });
    return Promise.resolve(Response.json(payload, { status }));
  });
  return requests;
};

beforeEach(() => {
  loggedFields.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a user who opted out of agent feedback", () => {
  it("is not offered send_feedback", async () => {
    const names = await listToolNames(optedOut);

    expect(names).not.toContain("send_feedback");
    expect(names).toHaveLength(Object.keys(toolset).length - 1);
    expect(names).toContain("list_calendars");
  });

  it("sends nothing when a client calls send_feedback anyway", async () => {
    const requests = stubFetch({ received: true }, 201);

    const { isError, text } = await callTool(optedOut, "send_feedback", {
      category: "other",
      message: "Works well.",
    });

    expect(isError).toBe(true);
    expect(text).toContain("disabled");
    expect(requests.filter(({ url }) => url === AGENT_FEEDBACK_URL)).toHaveLength(0);
  });

  it("gets no feedback note in the initialize instructions", async () => {
    const { instructions } = await initialize(optedOut);

    expect(instructions).toBeUndefined();
  });

  it("gets no feedback suggestion on unexpected errors", async () => {
    stubFetch({ error: "Internal server error" }, 500);

    const { isError, text } = await callTool(optedOut, "list_calendars", {});

    expect(isError).toBe(true);
    expect(text).toBe("Internal server error");
  });

  it("can still pass an intent, which is dropped without being recorded", async () => {
    const requests = stubFetch([]);

    const { isError } = await callTool(optedOut, "list_calendars", { intent: INTENT });

    expect(isError).toBe(false);
    expect(loggedFields.get("mcp.tool")).toBe("list_calendars");
    expect(loggedFields.has("mcp.intent")).toBe(false);
    expect(requests[0]?.body).not.toContain(INTENT);
  });
});

describe("a user who left agent feedback on", () => {
  it("is checked by their own user ID on every session", async () => {
    const checkedUserIds: string[] = [];
    const handler = createHandler((userId) => {
      checkedUserIds.push(userId);
      return Promise.resolve(true);
    });

    const names = await listToolNames(handler);

    expect(checkedUserIds).toEqual(["user-123"]);
    expect(names).toContain("send_feedback");
    const { instructions } = await initialize(handler);
    expect(instructions).toContain("send_feedback");
  });
});

describe("createAgentFeedbackAvailability", () => {
  it("follows each user's own setting on an instance that allows feedback", async () => {
    const availability = createAgentFeedbackAvailability({
      instanceDisabled: false,
      readUserPreference: (userId) => Promise.resolve(userId === "opted-in"),
    });

    expect(await availability("opted-in")).toBe(true);
    expect(await availability("opted-out")).toBe(false);
  });

  it("turns feedback off for every user when the instance disables it", async () => {
    const readUserPreference = vi.fn(() => Promise.resolve(true));
    const availability = createAgentFeedbackAvailability({ instanceDisabled: true, readUserPreference });

    expect(await availability("opted-in")).toBe(false);
    expect(readUserPreference).not.toHaveBeenCalled();
  });

  it("hides send_feedback from users on an instance that disables it", async () => {
    const handler = createHandler(createAgentFeedbackAvailability({
      instanceDisabled: true,
      readUserPreference: () => Promise.resolve(true),
    }));

    expect(await listToolNames(handler)).not.toContain("send_feedback");
  });
});

describe("AGENT_FEEDBACK_DISABLED", () => {
  const REQUIRED_ENV = {
    BETTER_AUTH_SECRET: "secret",
    BETTER_AUTH_URL: "https://keeper.example.com",
    DATABASE_URL: "postgres://keeper@localhost:5432/keeper",
    MCP_PORT: "3002",
    MCP_PUBLIC_URL: "https://keeper.example.com/mcp",
  };

  const loadEnv = async (agentFeedbackDisabled: string | undefined) => {
    vi.resetModules();
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("AGENT_FEEDBACK_DISABLED", agentFeedbackDisabled);
    const { default: env } = await import("../src/env");
    return env;
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("leaves feedback on when unset", async () => {
    const env = await loadEnv(globalThis.undefined);

    expect(env.AGENT_FEEDBACK_DISABLED).toBeUndefined();
  });

  it("reads true and false", async () => {
    const disabled = await loadEnv("true");
    expect(disabled.AGENT_FEEDBACK_DISABLED).toBe(true);
    const enabled = await loadEnv("false");
    expect(enabled.AGENT_FEEDBACK_DISABLED).toBe(false);
  });

  it("fails at startup on anything that is not a boolean", async () => {
    await expect(loadEnv("yes please")).rejects.toThrow(/AGENT_FEEDBACK_DISABLED/);
  });
});
