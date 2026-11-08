import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type FeedbackHandler = (context: { request: Request; userId: string }) => Promise<Response>;

const insertedRows: Record<string, unknown>[] = [];
const sentEmails: { template: { variables: Record<string, string> } }[] = [];

vi.mock("../../../src/utils/middleware", () => ({
  withAuth: (handler: unknown) => handler,
  withWideEvent: (handler: unknown) => handler,
}));
vi.mock("../../../src/context", () => ({
  database: {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        insertedRows.push(row);
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ email: "user@example.com" }]),
        }),
      }),
    }),
  },
  feedbackEmail: "feedback@example.com",
  resend: {
    emails: {
      send: (email: { template: { variables: Record<string, string> } }) => {
        sentEmails.push(email);
        return Promise.resolve();
      },
    },
  },
}));

let postFeedback: FeedbackHandler = () => Promise.reject(new Error("Module not loaded"));

beforeAll(async () => {
  const route = await import("../../../src/routes/api/feedback");
  postFeedback = route.POST as unknown as FeedbackHandler;
});

beforeEach(() => {
  insertedRows.length = 0;
  sentEmails.length = 0;
});

const submit = (body: Record<string, unknown>): Promise<Response> =>
  postFeedback({
    request: new Request("http://localhost/api/feedback", {
      body: JSON.stringify(body),
      method: "POST",
    }),
    userId: "user-1",
  });

describe("POST /api/feedback", () => {
  it("states the stored follow-up preference when the form does not ask for one", async () => {
    const response = await submit({ message: "Events sync an hour early", type: "feedback" });

    expect(response.status).toBe(200);
    expect(insertedRows[0]?.wantsFollowUp).toBe(false);
    expect(sentEmails[0]?.template.variables.wantsFollowUp).toBe("no");
  });

  it("passes an explicit follow-up preference through to the notification", async () => {
    await submit({ message: "Broken sync", type: "report", wantsFollowUp: true });

    expect(insertedRows[0]?.wantsFollowUp).toBe(true);
    expect(sentEmails[0]?.template.variables.wantsFollowUp).toBe("yes");
  });
});
