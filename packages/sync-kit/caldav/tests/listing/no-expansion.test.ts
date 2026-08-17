import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { calendarPath } from "../support/fake-caldav";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { calendarOf } from "../support/resources";

describe("a series leaves this adapter as a series", () => {
  test("DAV-O32: a recurring master leaves the adapter unexpanded, with its anchor intact", async () => {
    const harness = createHarness({
      resources: [
        {
          path: `${calendarPath}series.ics`,
          data: calendarOf([
            {
              uid: "series@example.com",
              summary: "Weekly",
              tzid: "Europe/Berlin",
              start: "20260302T090000",
              end: "20260302T100000",
              extraLines: ["RRULE:FREQ=WEEKLY;COUNT=10"],
            },
          ]),
        },
      ],
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    const [event] = listing.events ?? [];
    expect((listing.events ?? []).length).toBe(1);
    expect(event?.content.recurrence?.value).toBe("FREQ=WEEKLY;COUNT=10");
    expect(event?.content.anchor?.kind).toBe("timed");
    expect(harness.fake.requests().some((entry) => entry.body.includes("expand"))).toBe(false);
  }, 30_000);
});
