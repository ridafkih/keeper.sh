import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createKeeperMcpHandler } from "../src/mcp-handler";
import { createKeeperMcpToolset } from "../src/toolset";
import { AGENT_FEEDBACK_URL } from "../src/tools/feedback-tools";
import { testFeedbackOptions } from "./helpers/feedback-options";

const loggedFields = new Map<string, unknown>();

vi.mock("../src/utils/logging", () => ({
  widelog: { set: (key: string, value: unknown) => loggedFields.set(key, value) },
}));

const toolset = createKeeperMcpToolset({ feedback: testFeedbackOptions });

const INTENT = "Find a free hour for the user's dentist appointment next week";

const CALENDAR_ID = "00000000-0000-4000-8000-000000000001";

const handler = createKeeperMcpHandler({
  auth: {
    api: {
      getMcpSession: () => Promise.resolve({ scopes: "keeper.read", userId: "user-123" }),
    },
  },
  mcpPublicUrl: "https://mcp.keeper.sh",
  apiBaseUrl: "https://keeper.example.com",
  toolset,
});

const sendRpc = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
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

const callTool = async (name: string, args: Record<string, unknown>) => {
  const { result } = callToolResultSchema.parse(await sendRpc("tools/call", { arguments: args, name }));
  return { isError: result.isError ?? false, text: result.content.map(({ text }) => text).join("") };
};

const listToolsResultSchema = z.object({
  result: z.object({
    tools: z.array(z.object({
      name: z.string(),
      inputSchema: z.object({
        properties: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
        required: z.array(z.string()).optional(),
      }),
    })),
  }),
});

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

const createdEvent = {
  calendarId: CALENDAR_ID,
  calendarName: "Work",
  calendarProvider: "google",
  calendarUrl: null,
  description: null,
  endTime: "2026-11-12T16:00:00.000Z",
  eventStateId: null,
  id: "event-1",
  isAllDay: false,
  location: null,
  startTime: "2026-11-12T15:00:00.000Z",
  title: "Dentist",
};

const createEventArgs = {
  calendarId: CALENDAR_ID,
  endTime: "2026-11-12T16:00:00.000Z",
  startTime: "2026-11-12T15:00:00.000Z",
  title: "Dentist",
};

beforeEach(() => {
  loggedFields.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tool intent", () => {
  it("offers an optional intent of at most 300 characters on every tool", async () => {
    const { result } = listToolsResultSchema.parse(await sendRpc("tools/list", {}));

    expect(result.tools).toHaveLength(Object.keys(toolset).length);
    for (const tool of result.tools) {
      expect(tool.inputSchema.properties?.intent, tool.name).toMatchObject({ maxLength: 300, type: "string" });
      expect(tool.inputSchema.required ?? [], tool.name).not.toContain("intent");
    }
  });

  it("accepts a call that carries an intent", async () => {
    stubFetch([]);

    const { isError } = await callTool("list_calendars", { intent: INTENT });

    expect(isError).toBe(false);
  });

  it("records the intent on the request's wide event beside the tool name", async () => {
    stubFetch([]);

    await callTool("list_calendars", { intent: INTENT });

    expect(loggedFields.get("mcp.tool")).toBe("list_calendars");
    expect(loggedFields.get("mcp.intent")).toBe(INTENT);
  });

  it("records nothing when the agent gives no intent", async () => {
    stubFetch([]);

    await callTool("list_calendars", {});

    expect(loggedFields.has("mcp.intent")).toBe(false);
  });

  it("rejects an intent over 300 characters without calling the API", async () => {
    const requests = stubFetch([]);

    const { isError } = await callTool("list_calendars", { intent: "a".repeat(301) });

    expect(isError).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it("keeps the intent out of what the tool sends to the API", async () => {
    const withIntent = stubFetch(createdEvent);
    await callTool("create_event", { ...createEventArgs, intent: INTENT });
    const withoutIntent = stubFetch(createdEvent);
    await callTool("create_event", createEventArgs);

    expect(withIntent[0]?.body).not.toContain(INTENT);
    expect(withIntent).toEqual(withoutIntent);
  });

  it("returns the same result whether an intent is present or not", async () => {
    stubFetch(createdEvent);
    const withIntent = await callTool("create_event", { ...createEventArgs, intent: INTENT });
    const withoutIntent = await callTool("create_event", createEventArgs);

    expect(withIntent).toEqual(withoutIntent);
    expect(withIntent.text).not.toContain(INTENT);
  });

  it("keeps the intent of other calls out of the feedback pipeline", async () => {
    const requests = stubFetch({ received: true }, 201);

    await callTool("list_calendars", { intent: INTENT });
    await callTool("send_feedback", { category: "other", message: "Works well." });

    const feedback = requests.find(({ url }) => url === AGENT_FEEDBACK_URL);
    expect(feedback?.body).not.toContain(INTENT);
    expect(JSON.parse(feedback?.body ?? "{}")).not.toHaveProperty("intent");
  });

  it("forwards the intent given on the feedback call itself", async () => {
    const requests = stubFetch({ received: true }, 201);

    const { text } = await callTool("send_feedback", {
      category: "missing_capability",
      intent: "Move an event to another calendar",
      message: "There is no tool to move an event between calendars.",
    });

    const feedback = requests.find(({ url }) => url === AGENT_FEEDBACK_URL);
    expect(JSON.parse(feedback?.body ?? "{}")).toMatchObject({ intent: "Move an event to another calendar" });
    expect(text).not.toContain("Move an event to another calendar");
  });
});
