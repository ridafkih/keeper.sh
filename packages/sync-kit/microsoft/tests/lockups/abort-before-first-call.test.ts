import { describe, expect, test } from "vitest";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";

describe("a cancelled run is never charged as a provider failure", () => {
  test("MS-L21: an abort before the first request is notAttempted with zero transport calls", async () => {
    const harness = createHarness();
    const caller = new AbortController();
    caller.abort();

    const answered = await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, { signal: caller.signal }),
    );

    expect(harness.environment.transport.callCount()).toBe(0);
    expect(harness.fake.listCallCount()).toBe(0);
    if (answered.ok) {
      throw new Error("an already-aborted listing answered a value");
    }
    expect(answered.failure).toEqual({ kind: "notAttempted", reason: "aborted" });
  }, 30_000);
});
