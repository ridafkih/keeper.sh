import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { seedOf, timedItem } from "../support/items";

const onePageOfMixedQuality = [
  timedItem({
    id: "id-good",
    uid: "good",
    start: "2026-03-14T09:00:00.0000000",
    end: "2026-03-14T10:00:00.0000000",
  }),
  timedItem({
    id: "id-broken",
    uid: "broken",
    start: "2026-03-14T11:00:00.0000000",
    end: "2026-03-14T12:00:00.0000000",
    originalStartTimeZone: "Nonsense Standard Time",
    timeZone: "Nonsense Standard Time",
  }),
];

describe("ingesting the same page twice is the same answer twice", () => {
  test("MS-O43: the same page ingested twice discards the same identities and changes nothing", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems(onePageOfMixedQuality);

    const first = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );
    const second = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(second.withheld).toEqual(first.withheld);
    expect(second.diagnostics.withheld).toEqual(first.diagnostics.withheld);
    expect(second.events?.map((event) => event.fingerprint.value)).toEqual(
      first.events?.map((event) => event.fingerprint.value),
    );
  });
});
