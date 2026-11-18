import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type AgentFeedbackHandler = (context: { request: Request }) => Promise<Response>;

interface SentEmail {
  subject: string;
  to: string;
  replyTo?: string;
  template: { id: string; variables: Record<string, string> };
}

const insertedRows: Record<string, unknown>[] = [];
const sentEmails: SentEmail[] = [];
const loggedFields = new Map<string, unknown>();
const emailOutcome: { error: unknown } = { error: null };

vi.mock("../../../../src/utils/middleware", () => ({
  withWideEvent: (handler: unknown) => handler,
}));
vi.mock("../../../../src/utils/logging", () => ({
  widelog: { set: (key: string, value: unknown) => loggedFields.set(key, value) },
}));
vi.mock("../../../../src/context", () => ({
  database: {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        insertedRows.push(row);
        return Promise.resolve();
      },
    }),
  },
  feedbackEmail: "feedback@example.com",
  resend: {
    emails: {
      send: (email: SentEmail) => {
        sentEmails.push(email);
        return Promise.resolve({ data: null, error: emailOutcome.error });
      },
    },
  },
}));

let postAgentFeedback: AgentFeedbackHandler = () => Promise.reject(new Error("Module not loaded"));

beforeAll(async () => {
  const route = await import("../../../../src/routes/api/v1/agent-feedback");
  postAgentFeedback = route.POST as unknown as AgentFeedbackHandler;
});

beforeEach(() => {
  insertedRows.length = 0;
  sentEmails.length = 0;
  loggedFields.clear();
  emailOutcome.error = null;
});

const VALID_BODY = {
  category: "missing_capability",
  deployment: "self-hosted",
  message: "Wanted to move an event between calendars; there is no tool for it, so I deleted and recreated it.",
  severity: "medium",
  toolName: "update_event",
  version: "2.29.0",
};

const MCP_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "keeper-mcp/2.29.0",
};

const submitRaw = (body: string, headers: Record<string, string> = MCP_HEADERS): Promise<Response> =>
  postAgentFeedback({
    request: new Request("http://localhost/api/v1/agent-feedback", {
      body,
      headers,
      method: "POST",
    }),
  });

const submit = (body: Record<string, unknown>): Promise<Response> => submitRaw(JSON.stringify(body));

describe("POST /api/v1/agent-feedback", () => {
  it("stores the submission and confirms it", async () => {
    const response = await submit(VALID_BODY);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ received: true });
    expect(insertedRows).toEqual([VALID_BODY]);
  });

  it("emails the team under an agent feedback subject, apart from human feedback", async () => {
    await submit(VALID_BODY);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]?.subject).toBe("Agent feedback: missing_capability (medium) on update_event");
    expect(sentEmails[0]?.template.id).toBe("agent-feedback");
    expect(sentEmails[0]?.template.id).not.toBe("user-feedback");
    expect(sentEmails[0]?.to).toBe("feedback@example.com");
    expect(sentEmails[0]?.replyTo).toBeUndefined();
    expect(sentEmails[0]?.template.variables).toEqual({
      category: "missing_capability",
      deployment: "self-hosted",
      intent: "none",
      message: VALID_BODY.message,
      severity: "medium",
      toolName: "update_event",
      version: "2.29.0",
    });
  });

  it("accepts feedback that is not about a single tool", async () => {
    const { toolName: _toolName, ...withoutTool } = VALID_BODY;
    const response = await submit(withoutTool);

    expect(response.status).toBe(201);
    expect(sentEmails[0]?.subject).toBe("Agent feedback: missing_capability (medium)");
    expect(sentEmails[0]?.template.variables.toolName).toBe("none");
  });

  it("stores the intent the agent gave its feedback call", async () => {
    await submit({ ...VALID_BODY, intent: "Move the user's dentist appointment to Friday" });

    expect(insertedRows[0]?.intent).toBe("Move the user's dentist appointment to Friday");
    expect(sentEmails[0]?.template.variables.intent).toBe("Move the user's dentist appointment to Friday");
  });

  it("trims the message before storing it", async () => {
    await submit({ ...VALID_BODY, message: "   The free-time result had no timezone.  " });

    expect(insertedRows[0]?.message).toBe("The free-time result had no timezone.");
  });

  it("keeps the submission when the notification fails", async () => {
    emailOutcome.error = { message: "template not found" };
    const response = await submit(VALID_BODY);

    expect(response.status).toBe(201);
    expect(insertedRows).toHaveLength(1);
    expect(loggedFields.get("agent_feedback.notified")).toBe(false);
  });

  it("never logs the message itself", async () => {
    await submit(VALID_BODY);

    expect([...loggedFields.values()]).not.toContain(VALID_BODY.message);
  });

  it.each([
    ["an empty message", { message: "   " }],
    ["a message over 2,000 characters", { message: "a".repeat(2001) }],
    ["an intent over 300 characters", { intent: "a".repeat(301) }],
    ["an empty intent", { intent: " " }],
    ["an unknown category", { category: "praise" }],
    ["an unknown severity", { severity: "critical" }],
    ["an unknown deployment", { deployment: "cloud" }],
    ["a tool name that is not a tool identifier", { toolName: "<script>" }],
    ["a tool name in another case", { toolName: "GetEvents" }],
    ["a version with spaces", { version: "2.29.0 beta" }],
    ["a user identifier", { userId: "user-1" }],
    ["an email address", { email: "person@example.com" }],
    ["a hostname", { hostname: "keeper.example.com" }],
    ["calendar data", { events: [] }],
  ])("rejects %s", async (_label, override) => {
    const response = await submit({ ...VALID_BODY, ...override });

    expect(response.status).toBe(400);
    expect(insertedRows).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });

  it.each([["category"], ["severity"], ["version"], ["deployment"], ["message"]])(
    "rejects a submission without %s",
    async (field) => {
      const response = await submit(Object.fromEntries(
        Object.entries(VALID_BODY).filter(([key]) => key !== field),
      ));

      expect(response.status).toBe(400);
      expect(insertedRows).toHaveLength(0);
    },
  );

  it("rejects a body that is not JSON", async () => {
    const response = await submitRaw("message=hello");

    expect(response.status).toBe(400);
    expect(insertedRows).toHaveLength(0);
  });

  it("rejects a client that is not a Keeper.sh MCP server", async () => {
    const response = await submitRaw(JSON.stringify(VALID_BODY), {
      "Content-Type": "application/json",
      "User-Agent": "curl/8.7.1",
    });

    expect(response.status).toBe(400);
    expect(loggedFields.get("agent_feedback.rejected")).toBe("client");
    expect(insertedRows).toHaveLength(0);
  });

  it("rejects a form post", async () => {
    const response = await submitRaw(JSON.stringify(VALID_BODY), {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "keeper-mcp/2.29.0",
    });

    expect(response.status).toBe(400);
    expect(insertedRows).toHaveLength(0);
  });

  it("rejects a body over the size cap", async () => {
    const response = await submitRaw(JSON.stringify({ ...VALID_BODY, padding: "a".repeat(9000) }));

    expect(response.status).toBe(413);
    expect(insertedRows).toHaveLength(0);
  });
});
