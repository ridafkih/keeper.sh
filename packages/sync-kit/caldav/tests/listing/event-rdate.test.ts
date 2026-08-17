import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { calendarPath } from "../support/fake-caldav";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { calendarOf } from "../support/resources";

const irregularSeries = (): { path: string; data: string } => ({
  path: `${calendarPath}rdate.ics`,
  data: calendarOf([
    {
      uid: "rdate@example.com",
      summary: "Irregular",
      tzid: "Europe/Berlin",
      start: "20260302T090000",
      end: "20260302T100000",
      extraLines: ["RRULE:FREQ=WEEKLY;COUNT=2", "RDATE;TZID=Europe/Berlin:20260415T090000"],
    },
    {
      uid: "plain@example.com",
      summary: "Plain",
      start: "20260305T090000Z",
      end: "20260305T100000Z",
    },
  ]),
});

describe("an event-level RDATE is an occurrence set an RRULE cannot express", () => {
  test("DAV-O71: a VEVENT carrying an event-level RDATE is withheld, never narrowed to its RRULE", async () => {
    const harness = createHarness({ resources: [irregularSeries()] });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    const withheldUids = (listing.withheld ?? []).map((entry) => entry.uid?.value ?? null);
    const listedUids = (listing.events ?? []).map((event) => event.uid.value);

    expect(withheldUids).toContain("rdate@example.com");
    expect(listedUids).not.toContain("rdate@example.com");
  }, 30_000);

  test("DAV-O71: the withheld series does not cost its neighbour in the same resource its listing", async () => {
    const harness = createHarness({ resources: [irregularSeries()] });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    expect((listing.events ?? []).map((event) => event.uid.value)).toEqual(["plain@example.com"]);
  }, 30_000);
});
