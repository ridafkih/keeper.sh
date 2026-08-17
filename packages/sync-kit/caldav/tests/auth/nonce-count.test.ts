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

describe("a strict digest server counts every request", () => {
  test("DAV-L2: concurrent collection probes never replay a nonce-count", async () => {
    const harness = createHarness({
      fake: { offersDigestOnly: true },
      resources: [singleEventResource("one.ics", { uid: "one@example.com" })],
    });
    const context = operationContext(harness.environment, { deadlineMs: 2000 });

    const probes = await Promise.all([
      harness.provider.listChanges({ scope: scopeOver(decadeWindow), resume: null }, context),
      harness.provider.listChanges({ scope: scopeOver(decadeWindow), resume: null }, context),
      harness.provider.listChanges(
        { scope: scopeOver(decadeWindow, secondCalendar), resume: null },
        context,
      ),
      harness.provider.listChanges(
        { scope: scopeOver(decadeWindow, secondCalendar), resume: null },
        context,
      ),
    ]);

    expect(probes.map((probe) => failureKindOf(probe))).toEqual(["ok", "ok", "ok", "ok"]);
    const counts = harness.fake.nonceCounts();
    expect(counts.length).toBeGreaterThan(0);
    expect(new Set(counts).size).toBe(counts.length);
  }, 30_000);

  test("DAV-L2: the nonce-counts are monotonic and zero-padded", async () => {
    const harness = createHarness({
      fake: { offersDigestOnly: true },
      resources: [singleEventResource("one.ics", { uid: "one@example.com" })],
    });

    await harness.provider.listChanges(
      { scope: scopeOver(decadeWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    const counts = harness.fake.nonceCounts();
    expect(counts.every((value) => value.length === 8)).toBe(true);
    expect(counts).toEqual([...counts].toSorted());
  }, 30_000);
});
