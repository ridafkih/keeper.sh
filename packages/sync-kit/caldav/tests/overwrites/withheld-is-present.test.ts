import { derivableRemovals } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { withinCalDAVWindow } from "../../src/window/membership";
import { knownMirrorOf, listingOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { singleEventResource } from "../support/resources";

describe("withheld is a present event this run could not build", () => {
  test("DAV-O48: an unrepresentable resource appears in withheld and derives no removal", async () => {
    const harness = createHarness({
      resources: [
        singleEventResource("healthy.ics", { uid: "healthy@example.com" }),
        singleEventResource("stalled.ics", {
          uid: "stalled@example.com",
          tzid: "Mars/Olympus",
          start: "20260321T090000",
          end: "20260321T100000",
        }),
      ],
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    expect((listing.events ?? []).map((event) => event.uid.value)).toEqual(["healthy@example.com"]);
    expect((listing.withheld ?? []).map((entry) => entry.uid?.value ?? null)).toEqual([
      "stalled@example.com",
    ]);
    expect(
      derivableRemovals({
        listing,
        known: knownMirrorOf(listing.events ?? []),
        withinWindow: withinCalDAVWindow,
      }),
    ).toEqual([]);
  }, 30_000);
});
