import { describe, expect, test } from "vitest";
import { graphMiddlewareChain } from "../../src/client/graph-client";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";

const throttleEveryCall = (harness: ReturnType<typeof createHarness>): void => {
  for (let call = 1; call <= 12; call += 1) {
    harness.fake.failListOn({
      onCall: call,
      status: 429,
      code: "activityLimitReached",
      retryAfter: "1",
    });
  }
};

describe("the SDK's own retry and redirect handlers are switched off", () => {
  test("MS-H5: a 429 produces exactly the adapter's own attempt count, so no SDK retry handler is active", async () => {
    const harness = createHarness();
    throttleEveryCall(harness);

    await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, {
        maxAttempts: 2,
        retryDelayCeilingMs: 1,
        deadlineMs: 5000,
      }),
    );

    expect(harness.fake.listCallCount()).toBe(2);
  }, 30_000);

  test("MS-H5: the middleware chain is explicit and carries nothing that retries or redirects", () => {
    const chain = graphMiddlewareChain({
      fetch: () => Promise.reject(new Error("the hygiene test never sends a request")),
      getAccessToken: () => Promise.resolve("a-token-we-already-hold"),
    });

    const names = chain.map((middleware) => middleware.constructor.name);
    expect(names).not.toContain("RetryHandler");
    expect(names).not.toContain("RedirectHandler");
    expect(chain.length).toBeGreaterThan(0);
  });
});
