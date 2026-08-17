import { describe, expect, test } from "vitest";
import { listingOf, outcomeOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { allDayContent, createIntent, normalizedOf } from "../support/intents";
import { seedOf } from "../support/items";

describe("an all-day range is a UTC-midnight pair, in every calendar's zone", () => {
  test("MS-O33: an all-day range is written as a UTC-midnight pair and reads back as the same days", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));

    outcomeOf(
      await harness.provider.write(
        createIntent(
          "idempotency-all-day",
          normalizedOf(allDayContent("2026-03-21", "2026-03-22")),
          "microsoft-tests",
        ),
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    );
    const submitted = harness.fake.requests().findLast((request) => request.method === "POST");
    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    );

    expect(submitted?.body).toMatchObject({
      isAllDay: true,
      start: { dateTime: "2026-03-21T00:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-03-22T00:00:00.0000000", timeZone: "UTC" },
    });
    expect(listing.events?.at(0)?.content.time).toEqual({
      kind: "allDay",
      startDate: { kind: "calendarDate", value: "2026-03-21" },
      endDateExclusive: { kind: "calendarDate", value: "2026-03-22" },
    });
  }, 30_000);
});
