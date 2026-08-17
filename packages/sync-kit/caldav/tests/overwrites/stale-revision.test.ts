import { derivableRemovals } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { withinCalDAVWindow } from "../../src/window/membership";
import { knownMirrorOf, listingOf } from "../support/expect";
import { calendarPath } from "../support/fake-caldav";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { calendarOf } from "../support/resources";

const olderThenUnbuildable = calendarOf([
  { uid: "moved@example.com", summary: "Where it used to be", sequence: 1 },
  {
    uid: "moved@example.com",
    summary: "Where the user moved it",
    sequence: 2,
    tzid: "Mars/Olympus",
    start: "20260321T110000",
    end: "20260321T120000",
  },
]);

describe("an unbuildable newest revision withholds rather than reverts", () => {
  test("DAV-O47: a withheld newest revision does not revert to the older one and does not delete the stored row", async () => {
    const harness = createHarness({
      resources: [{ path: `${calendarPath}moved.ics`, data: olderThenUnbuildable }],
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    expect((listing.events ?? []).map((event) => event.content.title)).toEqual([]);
    expect((listing.withheld ?? []).map((entry) => entry.reason)).toEqual([
      "supersededRevisionUnbuildable",
    ]);
    expect(
      derivableRemovals({
        listing,
        known: knownMirrorOf([]),
        withinWindow: withinCalDAVWindow,
      }),
    ).toEqual([]);
  }, 30_000);
});
