import { assertNotSnapshotUnderTruncation, derivableRemovals } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { withinCalDAVWindow } from "../../src/window/membership";
import { continuationOf, knownMirrorOf, listingOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { manyResources } from "../support/resources";

describe("a truncated page never describes the whole collection", () => {
  test("DAV-O8: a 507 on the collection href yields partial, a continuation and no coverage", async () => {
    const harness = createHarness({
      fake: { truncatesAfter: 2 },
      resources: manyResources(6),
    });

    const answered = await harness.provider.listChanges(
      { scope: scopeOver(decadeWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    assertNotSnapshotUnderTruncation(answered);
    const listing = listingOf(answered);
    expect(listing.kind).toBe("partial");
    expect(listing.coverage).toBeUndefined();
    expect(continuationOf(listing).value.length).toBeGreaterThan(0);
  }, 30_000);

  test("DAV-O9: a truncated page's events are reported and its absences are not", async () => {
    const harness = createHarness({
      fake: { truncatesAfter: 2 },
      resources: manyResources(6),
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    const known = knownMirrorOf([]);
    expect((listing.events ?? []).length).toBeGreaterThan(0);
    expect(derivableRemovals({ listing, known, withinWindow: withinCalDAVWindow })).toEqual([]);
  }, 30_000);
});
