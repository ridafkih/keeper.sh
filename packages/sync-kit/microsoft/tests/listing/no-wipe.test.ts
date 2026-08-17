import { describe, expect, test } from "vitest";
import { failureKindOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { manyForeignEvents, seedOf } from "../support/items";

describe("a failed fetch is not an empty calendar", () => {
  test("MS-O13: a transport failure mid-walk yields a failure, never an empty snapshot", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(6)));
    harness.fake.pageEvery(3);
    harness.fake.failListOn({ onCall: 2, status: 500, code: "internalServerError" });

    const answered = await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 5000 }),
    );

    expect(answered.ok).toBe(false);
    expect(failureKindOf(answered)).toBe("transport");
    expect(Object.hasOwn(answered, "value")).toBe(false);
  }, 30_000);

  test("MS-O13: a transport that throws out of the gate also fails, and reports no listing", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(2)));
    harness.environment.transport.answerWith({ kind: "throw", times: 1 });

    const answered = await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment),
    );

    expect(answered.ok).toBe(false);
    expect(Object.hasOwn(answered, "value")).toBe(false);
  });
});
