import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { seedOf, timedItem } from "../support/items";

const allTheNulls = timedItem({
  id: "id-nulls",
  uid: null,
  subject: null,
  seriesMasterId: null,
  start: "2026-03-14T09:00:00.0000000",
  end: "2026-03-14T10:00:00.0000000",
});

describe("Graph's legitimately null fields decode without an assertion", () => {
  test("MS-O18: a null iCalUId, seriesMasterId and subject all decode without an assertion", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([allTheNulls]);

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    const [only] = listing.events ?? [];
    expect(listing.events).toHaveLength(1);
    expect(only?.id.value).toBe("id-nulls");
    expect(only?.uid.value.length).toBeGreaterThan(0);
    expect(only?.content.title).toBe("");
  });
});
