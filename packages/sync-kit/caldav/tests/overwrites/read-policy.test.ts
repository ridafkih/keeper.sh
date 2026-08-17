import { derivableRemovals } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { withinCalDAVWindow } from "../../src/window/membership";
import { failureKindOf, knownMirrorOf, listingOf, outcomeKindOf } from "../support/expect";
import { calendarPath } from "../support/fake-caldav";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { normalizedOf, timedContent, updateIntent, versionOf } from "../support/intents";
import { singleEventResource, unparseableResource } from "../support/resources";

const collection = [
  singleEventResource("one.ics", { uid: "one@example.com" }),
  unparseableResource("broken.ics"),
];

describe("one unreadable resource, two policies", () => {
  test("DAV-O23: an unreadable resource on the write path fails the write instead of recreating", async () => {
    const harness = createHarness({ resources: collection });

    const written = await harness.provider.write(
      updateIntent(
        `${calendarPath}broken.ics`,
        normalizedOf(timedContent({ title: "Repaired" })),
        versionOf('"etag-2"'),
      ),
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    expect(outcomeKindOf(written)).toBe(`failure:${failureKindOf(written)}`);
    expect(written.ok).toBe(false);
    expect(harness.fake.requestsOf("PUT")).toEqual([]);
  }, 30_000);

  test("DAV-O24: the same unreadable resource on the listing path is withheld and counted", async () => {
    const harness = createHarness({ resources: collection });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    expect((listing.withheld ?? []).map((entry) => entry.reason)).toContain("unparseable");
    expect(listing.diagnostics.withheld.total).toBe(1);
    expect(
      derivableRemovals({
        listing,
        known: knownMirrorOf(listing.events ?? []),
        withinWindow: withinCalDAVWindow,
      }),
    ).toEqual([]);
  }, 30_000);
});
