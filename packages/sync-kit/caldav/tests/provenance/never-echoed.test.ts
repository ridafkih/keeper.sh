import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { selfAuthoredResource, singleEventResource } from "../support/resources";

const installation = "caldav-tests";

describe("our own mirror is never ingested as a source", () => {
  test("DAV-O34: an event carrying our provenance at a foreign path is still filtered after parse", async () => {
    const harness = createHarness({
      resources: [
        singleEventResource("theirs.ics", { uid: "theirs@example.com" }),
        selfAuthoredResource("looks-foreign.ics", installation, { uid: "ours@example.com" }),
      ],
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    expect((listing.events ?? []).map((event) => event.uid.value)).toEqual(["theirs@example.com"]);
    expect(listing.diagnostics.selfAuthored.total).toBe(1);
  }, 30_000);

  test("DAV-O35: a self-authored resource is never a mirror source", async () => {
    const harness = createHarness({
      resources: [selfAuthoredResource("ours.ics", installation, { uid: "ours@example.com" })],
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    const foreign = (listing.events ?? []).filter(
      (event) => event.provenance.kind === "foreign",
    );
    expect(foreign).toEqual([]);
    expect((listing.withheld ?? []).map((entry) => entry.reason)).toEqual(["selfAuthored"]);
  }, 30_000);
});
