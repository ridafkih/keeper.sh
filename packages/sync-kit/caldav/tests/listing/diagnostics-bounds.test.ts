import { assertNoContentInDiagnostics } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { caldavLimits } from "../../src/limits";
import { listingOf } from "../support/expect";
import { calendarPath } from "../support/fake-caldav";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { singleEventResource } from "../support/resources";

const HANG_TIMEOUT = 30_000;

const brokenResources = (count: number): readonly { path: string; data: string }[] =>
  Array.from({ length: count }, (unused, index) => ({
    path: `${calendarPath}broken-${index}.ics`,
    data: "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:not-a-date\r\n",
  }));

describe("diagnostics are bounded samples beside exact totals", () => {
  test("DAV-H12: a 5,000-discard poll emits at most 20 sampled identifiers and the exact total", async () => {
    const discards = 5000;
    const harness = createHarness({
      fake: { announcesSyncCollection: false },
      resources: brokenResources(discards),
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    );

    expect(listing.diagnostics.withheld.total).toBe(discards);
    expect(listing.diagnostics.withheld.sample.length).toBe(caldavLimits.diagnosticSampleSize);
  }, HANG_TIMEOUT);

  test("DAV-H13: no diagnostics field carries event content", async () => {
    const secret = "Quarterly numbers for the board";
    const harness = createHarness({
      fake: { announcesSyncCollection: false },
      resources: [singleEventResource("one.ics", { uid: "one@example.com", summary: secret })],
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    assertNoContentInDiagnostics(listing, [secret]);
    expect(listing.diagnostics.pagesFetched).toBeGreaterThan(0);
  }, HANG_TIMEOUT);
});
