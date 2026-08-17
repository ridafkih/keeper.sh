import { describe, expect, test } from "vitest";
import { createAuthScope } from "../../src/client/auth-scope";
import { failureKindOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { singleEventResource } from "../support/resources";

describe("one probe's 401 is not a verdict about the account", () => {
  test("DAV-O51: a denied task collection beside a successful calendar probe is not reauthRequired", async () => {
    const harness = createHarness({
      resources: [singleEventResource("one.ics", { uid: "one@example.com" })],
    });
    const scope = createAuthScope();

    scope.record(401);
    scope.record(207);

    expect(scope.verdict()).toBe("authenticated");
    const listed = await harness.provider.listChanges(
      { scope: scopeOver(decadeWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );
    expect(failureKindOf(listed)).toBe("ok");
  }, 30_000);

  test("DAV-O52: a timeout is reported as a timeout whether it settles before or after the 401", () => {
    const deniedFirst = createAuthScope();
    deniedFirst.record(401);
    deniedFirst.record(408);

    const timedOutFirst = createAuthScope();
    timedOutFirst.record(408);
    timedOutFirst.record(401);

    expect(deniedFirst.verdict()).toBe(timedOutFirst.verdict());
    expect(deniedFirst.verdict()).toBe("denied");
  }, 30_000);
});
