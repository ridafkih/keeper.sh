import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { calendarPath } from "../support/fake-caldav";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { calendarOf } from "../support/resources";

describe("an Outlook feed's Windows TZID resolves to IANA", () => {
  test("DAV-O56: a resource with a Windows TZID resolves to an IANA zone and keeps the original TZID in its synthesized VTIMEZONE", async () => {
    const harness = createHarness({
      resources: [
        {
          path: `${calendarPath}windows.ics`,
          data: calendarOf([
            {
              uid: "windows@example.com",
              summary: "From Outlook",
              tzid: "W. Europe Standard Time",
              start: "20260321T100000",
              end: "20260321T110000",
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
    if (!event || event.content.recurrence !== null || event.content.time.kind !== "timed") {
      throw new Error("the listing described no timed single-occurrence event");
    }
    expect(event.content.time.zone?.value).toBe("Europe/Berlin");
    expect(event.content.time.start.value).toBe("2026-03-21T09:00:00.000Z");
  }, 30_000);
});
