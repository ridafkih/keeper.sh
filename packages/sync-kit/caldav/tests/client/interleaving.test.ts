import { describe, expect, test } from "vitest";
import { failureKindOf } from "../support/expect";
import {
  createHarness,
  decadeWindow,
  operationContext,
  scopeOver,
  secondCalendar,
} from "../support/harness";
import { singleEventResource } from "../support/resources";

describe("two operations on one client share no verdict and no digest state", () => {
  test("DAV-L18: two listChanges calls on one client interleave without sharing a verdict or a nonce-count", async () => {
    const harness = createHarness({
      fake: { offersDigestOnly: true },
      resources: [singleEventResource("one.ics")],
    });
    const context = operationContext(harness.environment, { deadlineMs: 2000 });

    const [personal, work] = await Promise.all([
      harness.provider.listChanges({ scope: scopeOver(decadeWindow), resume: null }, context),
      harness.provider.listChanges(
        { scope: scopeOver(decadeWindow, secondCalendar), resume: null },
        context,
      ),
    ]);

    expect(failureKindOf(personal)).toBe("ok");
    expect(failureKindOf(work)).toBe("ok");
    const counts = harness.fake.nonceCounts();
    expect(new Set(counts).size).toBe(counts.length);
  }, 30_000);
});
