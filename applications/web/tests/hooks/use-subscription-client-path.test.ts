import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { HttpError } from "../../src/lib/fetcher";
import { fetchSubscriptionState } from "../../src/hooks/use-subscription";

const CUSTOMER_STATE_PATH = "/api/auth/customer/state";
const ENTITLEMENTS_PATH = "/api/entitlements";

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const htmlResponse = (status: number): Response =>
  new Response("<html><body>502 Bad Gateway</body></html>", {
    status,
    headers: { "content-type": "text/html" },
  });

const stubFetch = (respond: (path: string) => Response) => {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
    const [input] = args;
    const path = typeof input === "string" ? input : input.toString();
    calls.push(path);
    return respond(path);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
};

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  vi.unstubAllGlobals();
});

describe("browser subscription read", () => {
  it("reads the plan and interval straight from a healthy customer state", async () => {
    const { calls } = stubFetch(() =>
      jsonResponse(200, { activeSubscriptions: [{ recurringInterval: "year" }] }),
    );

    await expect(fetchSubscriptionState()).resolves.toEqual({
      plan: "pro",
      interval: "year",
    });
    expect(calls).toEqual([CUSTOMER_STATE_PATH]);
  });

  it("sends the session cookie on both reads", async () => {
    const { fetchMock } = stubFetch((path) =>
      path === CUSTOMER_STATE_PATH
        ? jsonResponse(500, { error: "upstream" })
        : jsonResponse(200, { plan: "pro" }),
    );

    await fetchSubscriptionState();

    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({ credentials: "include" });
    }
  });

  it("keeps a paying user on pro when the customer state returns a gateway error page", async () => {
    const { calls } = stubFetch((path) =>
      path === CUSTOMER_STATE_PATH
        ? htmlResponse(502)
        : jsonResponse(200, { plan: "pro" }),
    );

    await expect(fetchSubscriptionState()).resolves.toEqual({
      plan: "pro",
      interval: null,
    });
    expect(calls).toEqual([CUSTOMER_STATE_PATH, ENTITLEMENTS_PATH]);
  });

  it("keeps a paying user on pro when the customer state answers 200 with an unparseable body", async () => {
    const { calls } = stubFetch((path) =>
      path === CUSTOMER_STATE_PATH
        ? htmlResponse(200)
        : jsonResponse(200, { plan: "pro" }),
    );

    await expect(fetchSubscriptionState()).resolves.toEqual({
      plan: "pro",
      interval: null,
    });
    expect(calls).toEqual([CUSTOMER_STATE_PATH, ENTITLEMENTS_PATH]);
  });

  it("keeps a paying user on pro when the customer state answers 204 with no body", async () => {
    const { calls } = stubFetch((path) =>
      path === CUSTOMER_STATE_PATH
        ? new Response(null, { status: 204 })
        : jsonResponse(200, { plan: "pro" }),
    );

    await expect(fetchSubscriptionState()).resolves.toEqual({
      plan: "pro",
      interval: null,
    });
    expect(calls).toEqual([CUSTOMER_STATE_PATH, ENTITLEMENTS_PATH]);
  });

  it("propagates a 401 from the browser read so the login redirect still fires", async () => {
    const { calls } = stubFetch(() => jsonResponse(401, { error: "unauthorized" }));

    await expect(fetchSubscriptionState()).rejects.toBeInstanceOf(HttpError);
    expect(calls).toEqual([CUSTOMER_STATE_PATH]);
  });

  it("does not downgrade to free when the fallback body is unusable", async () => {
    stubFetch((path) =>
      path === CUSTOMER_STATE_PATH
        ? jsonResponse(500, { error: "upstream" })
        : jsonResponse(200, { plan: null }),
    );

    await expect(fetchSubscriptionState()).rejects.toThrow();
  });

  it("does not downgrade to free when the fallback returns a gateway error page", async () => {
    stubFetch((path) =>
      path === CUSTOMER_STATE_PATH
        ? jsonResponse(500, { error: "upstream" })
        : htmlResponse(200),
    );

    await expect(fetchSubscriptionState()).rejects.toThrow();
  });

  it("issues exactly two requests per attempt and never retries in a loop", async () => {
    const { calls } = stubFetch((path) =>
      path === CUSTOMER_STATE_PATH
        ? jsonResponse(500, { error: "upstream" })
        : jsonResponse(200, { plan: "pro" }),
    );

    await fetchSubscriptionState();
    await fetchSubscriptionState();
    await fetchSubscriptionState();

    expect(calls).toEqual([
      CUSTOMER_STATE_PATH,
      ENTITLEMENTS_PATH,
      CUSTOMER_STATE_PATH,
      ENTITLEMENTS_PATH,
      CUSTOMER_STATE_PATH,
      ENTITLEMENTS_PATH,
    ]);
  });

  it("resolves concurrent browser reads to the same state", async () => {
    stubFetch((path) =>
      path === CUSTOMER_STATE_PATH
        ? jsonResponse(429, { error: "rate limited" })
        : jsonResponse(200, { plan: "pro" }),
    );

    const results = await Promise.all([
      fetchSubscriptionState(),
      fetchSubscriptionState(),
      fetchSubscriptionState(),
    ]);

    expect(results).toEqual(Array(3).fill({ plan: "pro", interval: null }));
  });
});
