import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { calendarPath } from "../support/fake-caldav";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { calendarOf } from "../support/resources";

describe("a TZID the feed forgot to declare is still resolvable", () => {
  test("DAV-O27: a TZID the feed never declares still resolves to the right instant", async () => {
    const harness = createHarness({
      resources: [
        {
          path: `${calendarPath}undeclared.ics`,
          data: calendarOf([
            {
              uid: "undeclared@example.com",
              summary: "Undeclared zone",
              tzid: "Europe/Berlin",
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
    if (!event || event.content.recurrence !== null) {
      throw new Error("the listing described no single-occurrence event");
    }
    expect(event.content.time.kind).toBe("timed");
    if (event.content.time.kind !== "timed") {
      throw new Error("an all-day time appeared where a timed one was written");
    }
    expect(event.content.time.start.value).toBe("2026-03-21T09:00:00.000Z");
  }, 30_000);
});
