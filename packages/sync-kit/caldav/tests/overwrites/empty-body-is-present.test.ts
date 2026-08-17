import { derivableRemovals } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { withinCalDAVWindow } from "../../src/window/membership";
import { knownMirrorOf, listingOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { emptyBodyResource, singleEventResource } from "../support/resources";

describe("a whitespace body is unread, not absent", () => {
  test("DAV-O21: an empty calendar-data body withholds the resource and derives no removal", async () => {
    const harness = createHarness({
      resources: [
        singleEventResource("one.ics", { uid: "one@example.com" }),
        emptyBodyResource("blank.ics"),
      ],
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    const withheldIds = (listing.withheld ?? []).map((entry) => entry.id?.value ?? null);
    expect(withheldIds).toContain("/calendars/alice/personal/blank.ics");
    expect(
      derivableRemovals({
        listing,
        known: knownMirrorOf(listing.events ?? []),
        withinWindow: withinCalDAVWindow,
      }),
    ).toEqual([]);
  }, 30_000);
});
