import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { timedItem } from "../support/items";

const twoInstancesOfOneSeries = () => [
  timedItem({
    id: "master_20260316T090000Z",
    uid: "series@google.com",
    start: "2026-03-16T09:00:00.000Z",
    end: "2026-03-16T10:00:00.000Z",
  }),
  timedItem({
    id: "master_20260317T090000Z",
    uid: "series@google.com",
    start: "2026-03-17T09:00:00.000Z",
    end: "2026-03-17T10:00:00.000Z",
  }),
];

describe("identity is the provider id, never the shared iCalUID", () => {
  test("GOOG-O20: two occurrences sharing an iCalUID are two identities", async () => {
    const harness = createHarness();
    harness.fake.putItems(twoInstancesOfOneSeries());

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    const ids = (listing.events ?? []).map((event) => event.id.value);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain("master_20260316T090000Z");
    expect(ids).toContain("master_20260317T090000Z");
  });

  test("GOOG-O20: the delete handle follows the instance, not the series", async () => {
    const harness = createHarness();
    harness.fake.putItems(twoInstancesOfOneSeries());

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    const handles = (listing.events ?? []).map((event) => event.deleteHandle.value);
    expect(new Set(handles).size).toBe(2);
  });
});
