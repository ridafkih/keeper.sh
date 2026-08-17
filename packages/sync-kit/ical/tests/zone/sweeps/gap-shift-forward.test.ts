import type { ZoneId } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { createZoneCache, instantToWallTime, resolveWallTime } from "../../../src/index";
import type { ZoneCache } from "../../../src/index";
import { adversarialZoneList, hourlyWallTimes } from "../../support/sweep";

const transitionDays = [
  { month: 3, day: 29 },
  { month: 4, day: 5 },
  { month: 9, day: 27 },
  { month: 10, day: 25 },
  { month: 11, day: 1 },
] as const;

const gapOffendersOnDay = (
  zone: ZoneId,
  zones: ZoneCache,
  month: number,
  day: number,
): readonly string[] => {
  const offenders: string[] = [];
  for (const wall of hourlyWallTimes(2026, month, day)) {
    const resolution = resolveWallTime({ kind: "wallTime", value: wall }, zone, zones);
    if (resolution.kind !== "gap") {
      continue;
    }
    if (resolution.shiftMinutes <= 0) {
      offenders.push(`${zone.value}@${wall}:shift`);
    }
    if (instantToWallTime(resolution.instant, zone, zones).value === wall) {
      offenders.push(`${zone.value}@${wall}:rendered`);
    }
  }
  return offenders;
};

const gapOffenders = (zones: ZoneCache): readonly string[] =>
  adversarialZoneList.flatMap((value) =>
    transitionDays.flatMap((slot) =>
      gapOffendersOnDay({ kind: "zoneId", value }, zones, slot.month, slot.day),
    ),
  );

describe("every wall time a zone skips", () => {
  test("ICAL-I20: the gap shifts forward by the size of the transition that removed it", () => {
    expect(gapOffenders(createZoneCache())).toEqual([]);
  });
});
