import { describe, expect, test } from "vitest";
import { decodeZoneId } from "../../src/decode/event-time";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { timedItem } from "../support/items";

describe("a non-IANA zone identifier never reaches a canonical event", () => {
  test("GOOG-O28: a Windows zone name on a Google event is withheld, not passed through", async () => {
    const harness = createHarness();
    harness.fake.putItems([
      timedItem({
        id: "windows-zone",
        start: "2026-03-18T09:00:00.000Z",
        end: "2026-03-18T10:00:00.000Z",
        timeZone: "Pacific Standard Time",
      }),
    ]);

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listing.events).toEqual([]);
    expect(listing.withheld?.at(0)?.reason).toBe("unresolvableTimeZone");
  });

  test("GOOG-O28: an IANA zone is admitted unchanged", () => {
    expect(decodeZoneId("Europe/Amsterdam")).toEqual({
      kind: "zoneId",
      value: "Europe/Amsterdam",
    });
  });

  test("GOOG-O28: a CLDR alias is refused rather than mapped here", () => {
    expect(decodeZoneId("Pacific Standard Time")).toBeNull();
  });
});
