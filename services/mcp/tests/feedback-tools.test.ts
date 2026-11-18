import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_FEEDBACK_URL, createFeedbackToolset, resolveDeployment } from "../src/tools/feedback-tools";
import type { KeeperToolContext } from "../src/tool-api";

const selfHostedContext: KeeperToolContext = {
  apiBaseUrl: "https://keeper.example.com",
  bearerToken: "user-oauth-token",
};

interface CapturedFeedback {
  url: string;
  method: string | null;
  headers: Headers;
  body: unknown;
}

const stubFeedbackEndpoint = (respond: () => Promise<Response>): CapturedFeedback[] => {
  const requests: CapturedFeedback[] = [];
  vi.stubGlobal("fetch", (url: string, options?: RequestInit) => {
    requests.push({
      body: JSON.parse(String(options?.body)),
      headers: new Headers(options?.headers),
      method: options?.method ?? null,
      url,
    });
    return respond();
  });
  return requests;
};

const acceptFeedback = () => Promise.resolve(Response.json({ received: true }, { status: 201 }));

const { send_feedback: sendFeedback } = createFeedbackToolset({
  deployment: "self-hosted",
  version: "2.29.0",
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("send_feedback", () => {
  it("is hardcoded to the Keeper.sh intake, so self-hosted feedback reaches the team too", () => {
    expect(AGENT_FEEDBACK_URL).toBe("https://www.keeper.sh/api/v1/agent-feedback");
  });

  it("posts to the Keeper.sh intake rather than the instance's own API", async () => {
    const requests = stubFeedbackEndpoint(acceptFeedback);

    await sendFeedback.execute(selfHostedContext, {
      category: "tool_error",
      message: "get_events returned a 500 for a one-day range.",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(AGENT_FEEDBACK_URL);
    expect(requests[0]?.url).not.toContain("keeper.example.com");
    expect(requests[0]?.method).toBe("POST");
  });

  it("sends only the feedback, the instance's version and whether it is hosted", async () => {
    const requests = stubFeedbackEndpoint(acceptFeedback);

    await sendFeedback.execute(selfHostedContext, {
      category: "missing_capability",
      message: "No tool moves an event to another calendar.",
      severity: "high",
      toolName: "update_event",
    });

    expect(requests[0]?.body).toEqual({
      category: "missing_capability",
      deployment: "self-hosted",
      message: "No tool moves an event to another calendar.",
      severity: "high",
      toolName: "update_event",
      version: "2.29.0",
    });
  });

  it("never forwards the user's token to Keeper.sh", async () => {
    const requests = stubFeedbackEndpoint(acceptFeedback);

    await sendFeedback.execute(selfHostedContext, { category: "other", message: "Works well." });

    expect(requests[0]?.headers.has("authorization")).toBe(false);
    expect(JSON.stringify(requests[0]?.body)).not.toContain("user-oauth-token");
  });

  it("identifies itself as a Keeper.sh MCP server of its version", async () => {
    const requests = stubFeedbackEndpoint(acceptFeedback);

    await sendFeedback.execute(selfHostedContext, { category: "other", message: "Works well." });

    expect(requests[0]?.headers.get("user-agent")).toBe("keeper-mcp/2.29.0");
    expect(requests[0]?.headers.get("content-type")).toBe("application/json");
  });

  it("defaults the severity to medium and leaves out a missing tool name", async () => {
    const requests = stubFeedbackEndpoint(acceptFeedback);

    await sendFeedback.execute(selfHostedContext, {
      category: "documentation",
      message: "The free-time docs do not say workingDays starts at Sunday.",
    });

    expect(requests[0]?.body).toMatchObject({ severity: "medium" });
    expect(requests[0]?.body).not.toHaveProperty("toolName");
  });

  it("confirms in one line so the agent carries on", async () => {
    stubFeedbackEndpoint(acceptFeedback);

    const result = await sendFeedback.execute(selfHostedContext, { category: "other", message: "Works well." });

    expect(result).toBe("Thanks, the Keeper.sh team received your feedback. Carry on with your task.");
  });

  it.each([
    ["the intake rejects it", () => Promise.resolve(Response.json({ error: "Invalid" }, { status: 400 }))],
    ["the intake is down", () => Promise.resolve(new Response(null, { status: 503 }))],
    ["the network fails", () => Promise.reject(new TypeError("fetch failed"))],
  ])("tells the agent to carry on when %s", async (_label, respond) => {
    stubFeedbackEndpoint(respond);

    const result = await sendFeedback.execute(selfHostedContext, { category: "other", message: "Works well." });

    expect(result).toBe("Your feedback could not be delivered right now. Carry on with your task.");
  });

  it("is marked as reaching outside the user's Keeper.sh", () => {
    expect(sendFeedback.annotations).toEqual({
      destructiveHint: false,
      openWorldHint: true,
      readOnlyHint: false,
    });
  });

  it("says when to use it and to leave out calendar data", () => {
    expect(sendFeedback.description).toContain("Keeper.sh team");
    expect(sendFeedback.description).toContain("unexpected error");
    expect(sendFeedback.description).toContain("missing");
    expect(sendFeedback.description).toContain("workaround");
    expect(sendFeedback.description).toContain("Never include the user's calendar data");
  });

  it.each([
    ["a message over 2,000 characters", { category: "other", message: "a".repeat(2001) }],
    ["an empty message", { category: "other", message: "   " }],
    ["an unknown category", { category: "praise", message: "Nice." }],
    ["an unknown severity", { category: "other", message: "Nice.", severity: "critical" }],
    ["a tool name that is not an identifier", { category: "other", message: "Nice.", toolName: "Get Events" }],
  ])("refuses %s before anything is sent", (_label, input) => {
    const schema = sendFeedback.inputSchema ?? {};
    const parsed = Object.entries(input).map(([key, value]) => schema[key]?.safeParse(value).success);

    expect(parsed).toContain(false);
  });
});

describe("resolveDeployment", () => {
  it("reports the commercial instance as hosted", () => {
    expect(resolveDeployment(true)).toBe("hosted");
  });

  it("reports every other instance as self-hosted", () => {
    expect(resolveDeployment(false)).toBe("self-hosted");
  });
});
