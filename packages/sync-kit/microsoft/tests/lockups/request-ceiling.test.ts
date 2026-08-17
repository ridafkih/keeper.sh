import { describe, expect, test } from "vitest";
import { graphMiddlewareChain, GraphTransportHandler } from "../../src/client/graph-client";

const neverResolves = (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
  new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) {
      return;
    }
    signal.addEventListener("abort", () => reject(new Error("AbortError")), { once: true });
  });

describe("the operation deadline is the only ceiling, and the transport advertises no other", () => {
  test("MS-L28: the transport passes the caller's signal through and adds no timer of its own", async () => {
    const handler = new GraphTransportHandler(neverResolves);
    const caller = new AbortController();
    const context = {
      request: "https://graph.microsoft.com/v1.0/me/events",
      options: { method: "GET", signal: caller.signal },
    };

    const pending = handler.execute(context);
    caller.abort();

    await expect(pending).rejects.toThrow("AbortError");
  }, 30_000);

  test("MS-L29: the client takes no request ceiling it would not enforce", () => {
    const chain = graphMiddlewareChain({
      fetch: neverResolves,
      getAccessToken: () => Promise.resolve("a-token-we-already-hold"),
    });

    expect(Object.hasOwn(new GraphTransportHandler(neverResolves), "ceilingMs")).toBe(false);
    expect(chain.length).toBe(2);
  });
});
