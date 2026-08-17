import { createZoneCache } from "@keeper.sh/sync-ical";
import { describe, expect, test } from "vitest";
import { emittableDateTime, roundTrips } from "../../src/write/wall-time";

const newYork = { kind: "zoneId", value: "America/New_York" } as const;

const secondPassOfTheFallBackHour = {
  kind: "instant",
  value: "2026-11-01T06:30:00.000Z",
} as const;

const anOrdinaryAfternoon = { kind: "instant", value: "2026-03-21T18:00:00.000Z" } as const;

describe("a wall time that names two instants is written in UTC", () => {
  test("MS-O34: a second-pass fall-back instant is emitted in UTC", () => {
    const zones = createZoneCache();

    const emitted = emittableDateTime(secondPassOfTheFallBackHour, newYork, zones);

    expect(emitted.timeZone).toBe("UTC");
    expect(emitted.dateTime).toContain("2026-11-01T06:30:00");
    expect(roundTrips(secondPassOfTheFallBackHour, newYork, zones)).toBe(false);
  });

  test("MS-O34: an instant whose wall time round-trips keeps its zone", () => {
    const zones = createZoneCache();

    const emitted = emittableDateTime(anOrdinaryAfternoon, newYork, zones);

    expect(roundTrips(anOrdinaryAfternoon, newYork, zones)).toBe(true);
    expect(emitted.timeZone).toBe("America/New_York");
  });
});
