import { describe, expect, test } from "vitest";
import { failureKindOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { manyResources } from "../support/resources";

describe("a network blip never empties a calendar", () => {
  test("DAV-O2: a transport failure mid-listing is a Result failure, never an empty snapshot", async () => {
    const harness = createHarness({
      fake: { throwsOnMultiget: true, announcesSyncCollection: false },
      resources: manyResources(4),
    });

    const listed = await harness.provider.listChanges(
      { scope: scopeOver(decadeWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    expect(listed.ok).toBe(false);
    expect(failureKindOf(listed)).toBe("transport");
  }, 30_000);

  test("DAV-O2: the PROPFIND that did succeed does not become a snapshot on its own", async () => {
    const harness = createHarness({
      fake: { throwsOnMultiget: true, announcesSyncCollection: false },
      resources: manyResources(4),
    });

    const listed = await harness.provider.listChanges(
      { scope: scopeOver(decadeWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    if (listed.ok) {
      throw new Error(`a thrown multiget answered "${listed.value.kind}" instead of failing`);
    }
    expect(harness.fake.requestsOf("PROPFIND").length).toBeGreaterThan(0);
  }, 30_000);
});
