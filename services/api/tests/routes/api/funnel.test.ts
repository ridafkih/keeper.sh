import { beforeEach, describe, expect, it, vi } from "vitest";

let fields: Record<string, unknown> = {};

vi.mock("../../../src/utils/middleware", () => ({
  withAuth: (handler: unknown) => handler,
  withWideEvent: (handler: unknown) => handler,
}));

vi.mock("../../../src/utils/logging", () => ({
  widelog: {
    setFields: (next: Record<string, unknown>) => {
      fields = { ...fields, ...next };
    },
  },
}));

type FunnelHandler = (context: { request: Request; userId: string }) => Promise<Response>;

const { POST: postFunnel } = (await import("../../../src/routes/api/funnel")) as unknown as { POST: FunnelHandler };

const postFunnelEvent = (body: unknown) =>
  postFunnel({
    request: new Request("http://localhost/api/funnel", { body: JSON.stringify(body), method: "POST" }),
    userId: "user-1",
  });

beforeEach(() => {
  fields = {};
});

describe("POST /api/funnel", () => {
  it("puts a paywall view on the request's wide event", async () => {
    const response = await postFunnelEvent({ event: "billing.limit_shown", limitType: "mappings" });

    expect(response.status).toBe(204);
    expect(fields).toEqual({ "billing.limit_type": "mappings", "funnel.event": "billing.limit_shown" });
  });

  it("rejects a malformed event and records nothing", async () => {
    const response = await postFunnelEvent({ event: "billing.limit_shown", limitType: "free text" });

    expect(response.status).toBe(400);
    expect(fields).toEqual({});
  });
});
