import { createZoneCache } from "@keeper.sh/sync-ical";
import { describe, expect, test } from "vitest";
import { resolveOriginalZone } from "../../src/decode/original-zone";

describe("the event's own zone outranks the zone we asked for", () => {
  test("MS-O17: the original zone outranks the response zone, and an unresolvable pair is withheld rather than assumed UTC", () => {
    const zones = createZoneCache();

    const original = resolveOriginalZone(
      { originalStartTimeZone: "Eastern Standard Time", responseTimeZone: "UTC" },
      zones,
    );
    const fellBack = resolveOriginalZone(
      { originalStartTimeZone: "Nonsense Standard Time", responseTimeZone: "UTC" },
      zones,
    );
    const refused = resolveOriginalZone(
      { originalStartTimeZone: "Nonsense Standard Time", responseTimeZone: "Also Nonsense" },
      zones,
    );

    expect(original).toEqual({
      kind: "resolved",
      zone: { kind: "zoneId", value: "America/New_York" },
    });
    expect(fellBack).toEqual({ kind: "resolved", zone: { kind: "zoneId", value: "UTC" } });
    expect(refused.kind).toBe("unresolvable");
  });

  test("MS-O17: an absent original zone falls back rather than refusing", () => {
    const zones = createZoneCache();

    expect(
      resolveOriginalZone({ originalStartTimeZone: null, responseTimeZone: "UTC" }, zones),
    ).toEqual({ kind: "resolved", zone: { kind: "zoneId", value: "UTC" } });
  });
});
