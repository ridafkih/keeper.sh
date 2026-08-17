import { describe, expect, test } from "vitest";
import { listingOf, outcomeOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { createIntent, normalizedOf, timedContent } from "../support/intents";

const secondPassOfTheFold = timedContent({
  title: "In the repeated hour",
  start: "2026-11-01T05:30:00.000Z",
  end: "2026-11-01T06:00:00.000Z",
  zone: "America/New_York",
});

describe("an instant a wall clock names twice still round-trips to itself", () => {
  test("DAV-O28: an instant in a repeated hour round-trips to itself through a PUT and a re-read", async () => {
    const harness = createHarness();
    const context = operationContext(harness.environment, { deadlineMs: 2000 });

    const created = await harness.provider.write(
      createIntent("idem-fold", normalizedOf(secondPassOfTheFold), "caldav-tests"),
      context,
    );
    const listing = listingOf(
      await harness.provider.listChanges({ scope: scopeOver(decadeWindow), resume: null }, context),
    );

    expect(outcomeOf(created).kind).toBe("created");
    const [event] = listing.events ?? [];
    if (!event || event.content.recurrence !== null || event.content.time.kind !== "timed") {
      throw new Error("the re-read event was not the timed event that was written");
    }
    expect(event.content.time.start.value).toBe("2026-11-01T05:30:00.000Z");
  }, 30_000);
});
