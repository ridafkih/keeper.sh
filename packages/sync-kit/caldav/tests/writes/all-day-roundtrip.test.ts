import { describe, expect, test } from "vitest";
import { listingOf, outcomeOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { allDayContent, createIntent, normalizedOf } from "../support/intents";

describe("an all-day range does not narrow on the way round", () => {
  test("DAV-O30: an all-day event written and re-read is unchanged", async () => {
    const harness = createHarness();
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const content = allDayContent("2026-03-21", "2026-03-24");

    const created = await harness.provider.write(
      createIntent("idem-all-day", normalizedOf(content), "caldav-tests"),
      context,
    );
    const listing = listingOf(
      await harness.provider.listChanges({ scope: scopeOver(decadeWindow), resume: null }, context),
    );

    expect(outcomeOf(created).kind).toBe("created");
    const [event] = listing.events ?? [];
    if (!event || event.content.recurrence !== null || event.content.time.kind !== "allDay") {
      throw new Error("the re-read event was not the all-day event that was written");
    }
    expect(event.content.time.startDate.value).toBe("2026-03-21");
    expect(event.content.time.endDateExclusive.value).toBe("2026-03-24");
  }, 30_000);
});
