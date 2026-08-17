import { createZoneCache } from "@keeper.sh/sync-ical";
import { describe, expect, test } from "vitest";
import { resolveGraphZone } from "../../src/decode/zone";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { seedOf, timedItem } from "../support/items";

const zoneLabelled = (id: string, label: string) =>
  timedItem({
    id,
    uid: id,
    start: "2026-03-14T09:00:00.0000000",
    end: "2026-03-14T10:00:00.0000000",
    originalStartTimeZone: label,
    timeZone: label,
  });

describe("Microsoft zone labels go through the shared CLDR ladder", () => {
  test("MS-O16: a Windows zone name resolves through the shared CLDR ladder, and an unresolvable one withholds exactly one event", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([
      zoneLabelled("id-windows", "Eastern Standard Time"),
      zoneLabelled("id-custom", "tzone://Microsoft/Custom"),
      zoneLabelled("id-nonsense", "Nonsense Standard Time"),
    ]);

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listing.events).toHaveLength(2);
    expect(listing.withheld?.map((entry) => entry.reason)).toEqual(["unresolvableTimeZone"]);
  });

  test("MS-O16: the ladder answers a Windows label with its IANA zone and never throws on a nonsense one", () => {
    const zones = createZoneCache();

    expect(resolveGraphZone("Eastern Standard Time", zones)).toEqual({
      kind: "resolved",
      zone: { kind: "zoneId", value: "America/New_York" },
    });
    expect(resolveGraphZone("Nonsense Standard Time", zones).kind).toBe("unresolvable");
  });
});
