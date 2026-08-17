import { describe, expect, test } from "vitest";
import { cursorOf, listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { seedOf, timedItem } from "../support/items";

const wellDescribed = timedItem({
  id: "id-described",
  uid: "described",
  start: "2026-03-14T09:00:00.0000000",
  end: "2026-03-14T10:00:00.0000000",
  description: "the description Graph did not resend",
  location: "the location Graph did not resend",
});

describe("a terse delta item is a patch, never a blanking", () => {
  test("MS-O22: a delta patch never blanks a field it did not carry", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([wellDescribed]);
    const first = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putRaw([
      {
        id: "id-described",
        changeKey: "ck-2-id-described",
        start: { dateTime: "2026-03-14T11:00:00.0000000", timeZone: "UTC" },
      },
    ]);

    const second = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: cursorOf(first) },
        operationContext(harness.environment),
      ),
    );

    expect(second.events).toEqual([]);
    expect(second.withheld?.map((entry) => entry.reason)).toEqual(["unparseable"]);
  });
});
