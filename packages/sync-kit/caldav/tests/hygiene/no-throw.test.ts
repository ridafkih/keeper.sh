import { describe, expect, test } from "vitest";
import { failureKindOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { singleEventResource } from "../support/resources";
import { filesMatchingPattern, readSource } from "../support/sources";

const raisesAtItsCaller = /\bthrow\b|reject\(new /;

const coordinationRefusals = [
  "src/client/semaphore.ts",
  "src/client/single-flight.ts",
  "src/conformance-obligations.ts",
];

describe("this adapter returns Results; it does not throw at its callers", () => {
  test("DAV-H18: only the two coordination refusals throw, and the provider catches both", async () => {
    const throwers = await filesMatchingPattern("src", raisesAtItsCaller);
    const provider = await readSource("src/provider.ts");

    expect(throwers).toEqual(coordinationRefusals);
    expect(provider).toContain("PermitAborted");
    expect(provider).toContain("FlightAbandoned");
  });

  test("DAV-H18: a transport that throws becomes a Result failure, not an exception", async () => {
    const harness = createHarness({
      fake: { throwsOnMultiget: true },
      resources: [singleEventResource("one.ics")],
    });

    const listed = await harness.provider.listChanges(
      { scope: scopeOver(decadeWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    expect(failureKindOf(listed)).toBe("transport");
  }, 30_000);
});
