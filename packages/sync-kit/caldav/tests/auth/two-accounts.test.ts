import { describe, expect, test } from "vitest";
import { failureKindOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { singleEventResource } from "../support/resources";

describe("two accounts polling at once keep their own verdicts", () => {
  test("DAV-L3: two accounts polling concurrently do not share a verdict", async () => {
    const denied = createHarness({
      fake: { offersBasicOnly: true },
      credentials: {
        serverUrl: "https://dav.example.com",
        username: "bob",
        password: "",
        knownAuthMethod: null,
      },
    });
    const healthy = createHarness({
      resources: [singleEventResource("one.ics", { uid: "one@example.com" })],
    });
    const scope = scopeOver(decadeWindow);

    const [first, second] = await Promise.all([
      denied.provider.listChanges(
        { scope, resume: null },
        operationContext(denied.environment, { deadlineMs: 2000 }),
      ),
      healthy.provider.listChanges(
        { scope, resume: null },
        operationContext(healthy.environment, { deadlineMs: 2000 }),
      ),
    ]);

    expect(failureKindOf(second)).toBe("ok");
    expect(failureKindOf(first)).not.toBe("ok");
  }, 30_000);

  test("DAV-L3: neither account's poll waits on the other's transport", async () => {
    const first = createHarness({ fake: { stalls: true } });
    const second = createHarness({
      resources: [singleEventResource("one.ics", { uid: "one@example.com" })],
    });
    const scope = scopeOver(decadeWindow);

    const stalled = first.provider.listChanges(
      { scope, resume: null },
      operationContext(first.environment, { deadlineMs: 50 }),
    );
    const healthy = await second.provider.listChanges(
      { scope, resume: null },
      operationContext(second.environment, { deadlineMs: 2000 }),
    );

    expect(failureKindOf(healthy)).toBe("ok");
    expect(failureKindOf(await stalled)).toBe("notAttempted");
  }, 30_000);
});
