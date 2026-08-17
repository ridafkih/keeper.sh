import { describe, expect, test } from "vitest";
import { listingOf, outcomeOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { createIntent, normalizedOf, timedContent } from "../support/intents";

const acrossTheFallBack = timedContent({
  title: "Across the fall back",
  start: "2026-11-01T05:30:00.000Z",
  end: "2026-11-01T06:30:00.000Z",
  zone: "America/New_York",
});

describe("a DST boundary is a fixed point, not a rewrite trigger", () => {
  test("DAV-O26: a write→read→compare across a DST boundary is a fixed point", async () => {
    const harness = createHarness();
    const context = operationContext(harness.environment, { deadlineMs: 2000 });

    const created = await harness.provider.write(
      createIntent("idem-dst", normalizedOf(acrossTheFallBack), "caldav-tests"),
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
    expect(event.content.time.end.value).toBe("2026-11-01T06:30:00.000Z");
  }, 30_000);

  test("DAV-O26: the second write of the same content is not a change", async () => {
    const harness = createHarness();
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const intent = createIntent("idem-dst", normalizedOf(acrossTheFallBack), "caldav-tests");

    await harness.provider.write(intent, context);
    const replayed = await harness.provider.write(intent, context);

    expect(outcomeOf(replayed).kind).toBe("alreadyExists");
    expect(harness.fake.resources().length).toBe(1);
  }, 30_000);
});
