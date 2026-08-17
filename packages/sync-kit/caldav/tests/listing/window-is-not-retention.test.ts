import { derivableRemovals } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { withinCalDAVWindow } from "../../src/window/membership";
import { knownMirrorOf, listingOf } from "../support/expect";
import { calendarPath } from "../support/fake-caldav";
import {
  createHarness,
  decadeWindow,
  marchWindow,
  operationContext,
  scopeOver,
} from "../support/harness";
import { calendarOf, singleEventResource } from "../support/resources";

describe("the window bounds what is mirrored, never what is read", () => {
  test("DAV-O59: an event outside the requested window is listed, not removed", async () => {
    const harness = createHarness({
      resources: [
        singleEventResource("in.ics", { uid: "in@example.com" }),
        singleEventResource("out.ics", {
          uid: "out@example.com",
          start: "20190101T090000Z",
          end: "20190101T100000Z",
        }),
      ],
    });
    const scope = scopeOver(marchWindow);

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope, resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    expect((listing.events ?? []).map((event) => event.uid.value).toSorted()).toEqual([
      "in@example.com",
      "out@example.com",
    ]);
    expect(
      derivableRemovals({
        listing,
        known: knownMirrorOf(listing.events ?? []),
        withinWindow: withinCalDAVWindow,
      }),
    ).toEqual([]);
  }, 30_000);

  test("DAV-O60: a master before the window survives", async () => {
    const harness = createHarness({
      resources: [
        {
          path: `${calendarPath}old-series.ics`,
          data: calendarOf([
            {
              uid: "old-series@example.com",
              summary: "Long-running weekly",
              start: "20150105T090000Z",
              end: "20150105T100000Z",
              extraLines: ["RRULE:FREQ=WEEKLY"],
            },
          ]),
        },
      ],
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    expect((listing.events ?? []).map((event) => event.uid.value)).toEqual([
      "old-series@example.com",
    ]);
    expect(scopeOver(decadeWindow).window).toEqual(decadeWindow);
  }, 30_000);
});
