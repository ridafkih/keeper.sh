import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { singleEventResource } from "../support/resources";

describe("a response href is matched to the href it was requested under", () => {
  test("DAV-O19: a percent-encoded response href matches the decoded href it was requested under", async () => {
    const harness = createHarness({
      fake: { returnsPercentEncodedHrefs: true, announcesSyncCollection: false },
      resources: [singleEventResource("team offsite.ics", { uid: "offsite@example.com" })],
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    expect(listing.kind).toBe("snapshot");
    expect((listing.events ?? []).map((event) => event.id.value)).toEqual([
      "/calendars/alice/personal/team offsite.ics",
    ]);
  }, 30_000);

  test("DAV-H8: a duplicated href is requested once", async () => {
    const harness = createHarness({
      fake: { returnsPercentEncodedHrefs: true, announcesSyncCollection: false },
      resources: [singleEventResource("one.ics", { uid: "one@example.com" })],
    });

    await harness.provider.listChanges(
      { scope: scopeOver(decadeWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    const requested = harness.fake
      .reportsOf("calendar-multiget")
      .flatMap((entry) => [...entry.body.matchAll(/one\.ics/g)]);
    expect(requested.length).toBe(1);
  }, 30_000);
});
