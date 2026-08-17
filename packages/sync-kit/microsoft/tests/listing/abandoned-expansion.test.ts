import { describe, expect, test } from "vitest";
import { expandSeries } from "../../src/listing/expand-series";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { seedOf, seriesMasterItem } from "../support/items";

const abortedContext = (): AbortSignal => {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
};

describe("an expansion cut short never passes for a series with no occurrences", () => {
  test("MS-O46: an aborted expansion is abandoned, never an empty series", async () => {
    const harness = createHarness();
    let fetched = 0;

    const answered = await expandSeries({
      master: { kind: "remoteEventId", value: "master-abandoned" },
      context: operationContext(harness.environment, { signal: abortedContext() }),
      fetchInstances: () => {
        fetched += 1;
        return Promise.resolve({ kind: "expanded", instances: [] });
      },
    });

    expect(answered.kind).toBe("abandoned");
    expect(fetched).toBe(0);
  });

  test("MS-O47: a listing abandoned mid-expansion yields no snapshot claiming coverage", async () => {
    const harness = createHarness();
    const caller = new AbortController();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([seriesMasterItem("master-abandoned", "2026-03-16T09:00:00.0000000")]);
    harness.fake.putInstances("master-abandoned", []);
    caller.abort();

    const answered = await harness.provider.listChanges(
      { scope: { ...scopeOver(marchWindow), expandRecurrences: true }, resume: null },
      operationContext(harness.environment, { signal: caller.signal }),
    );

    if (answered.ok) {
      throw new Error(`an abandoned expansion answered a "${answered.value.kind}" listing`);
    }
    expect(answered.failure).toEqual({ kind: "notAttempted", reason: "aborted" });
  }, 30_000);
});
