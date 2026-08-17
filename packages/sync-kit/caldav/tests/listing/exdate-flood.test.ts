import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { calendarPath } from "../support/fake-caldav";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { calendarOf, singleEventResource } from "../support/resources";

const HANG_TIMEOUT = 30_000;

const exdates = (count: number): readonly string[] =>
  Array.from({ length: count }, (unused, index) => {
    const day = new Date(Date.UTC(2020, 0, 1) + index * 86_400_000);
    return `EXDATE:${day.toISOString().slice(0, 10).replaceAll("-", "")}T090000Z`;
  });

describe("a hostile recurrence does not sink the collection", () => {
  test("DAV-O61: a resource with 10,000 EXDATEs is withheld and the rest of the collection still lists", async () => {
    const flooded = calendarOf([
      {
        uid: "flood@example.com",
        summary: "Flooded",
        extraLines: ["RRULE:FREQ=DAILY", ...exdates(10_000)],
      },
    ]);
    const harness = createHarness({
      resources: [
        { path: `${calendarPath}flood.ics`, data: flooded },
        singleEventResource("healthy.ics", { uid: "healthy@example.com" }),
      ],
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    );

    expect((listing.events ?? []).map((event) => event.uid.value)).toEqual(["healthy@example.com"]);
    expect((listing.withheld ?? []).map((entry) => entry.uid?.value ?? null)).toEqual([
      "flood@example.com",
    ]);
  }, HANG_TIMEOUT);
});
