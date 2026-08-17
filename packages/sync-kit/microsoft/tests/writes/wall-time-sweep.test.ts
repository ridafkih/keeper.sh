import type { Instant, ZoneId } from "@keeper.sh/sync-protocol";
import { createZoneCache, instantToWallTime, resolveWallTime } from "@keeper.sh/sync-ical";
import { describe, expect, test } from "vitest";
import { emittableDateTime } from "../../src/write/wall-time";

const sweptZones: readonly string[] = [
  "UTC",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Berlin",
  "Africa/Cairo",
  "Asia/Tehran",
  "Asia/Kathmandu",
  "Asia/Tokyo",
  "Australia/Lord_Howe",
  "Pacific/Chatham",
  "Pacific/Apia",
];

const sweptInstants = (): readonly Instant[] => {
  const days = ["2026-03-08", "2026-03-29", "2026-04-05", "2026-10-04", "2026-10-25", "2026-11-01"];
  const hours = ["00:30", "01:30", "02:30", "03:30", "12:00", "23:30"];
  const instants: Instant[] = [];
  for (const day of days) {
    for (const hour of hours) {
      instants.push({ kind: "instant", value: `${day}T${hour}:00.000Z` });
    }
  }
  return instants;
};

const readsBackAs = (emitted: { dateTime: string; timeZone: string }, zones: ReturnType<typeof createZoneCache>): string => {
  const zone: ZoneId = { kind: "zoneId", value: emitted.timeZone };
  const wall = { kind: "wallTime", value: emitted.dateTime.replaceAll(/[-:]/g, "").slice(0, 15) } as const;
  return resolveWallTime(wall, zone, zones).instant.value;
};

describe("every pair we emit reads back as the instant it was built from", () => {
  test("MS-O35: every emitted pair reads back as the instant it was built from", () => {
    const zones = createZoneCache();
    const drifted: string[] = [];

    for (const zoneName of sweptZones) {
      const zone: ZoneId = { kind: "zoneId", value: zoneName };
      for (const instant of sweptInstants()) {
        const emitted = emittableDateTime(instant, zone, zones);
        if (typeof emitted.dateTime !== "string" || typeof emitted.timeZone !== "string") {
          drifted.push(`${zoneName}@${instant.value}: an emitted pair was incomplete`);
          continue;
        }
        const readBack = readsBackAs({ dateTime: emitted.dateTime, timeZone: emitted.timeZone }, zones);
        if (readBack !== instant.value) {
          drifted.push(`${zoneName}@${instant.value} read back as ${readBack}`);
        }
      }
    }

    expect(drifted).toEqual([]);
    expect(instantToWallTime({ kind: "instant", value: "2026-03-21T18:00:00.000Z" }, { kind: "zoneId", value: "UTC" }, zones).value).toBe(
      "20260321T180000",
    );
  }, 10_000);
});
