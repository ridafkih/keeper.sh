import type { ZoneId } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { createZoneCache, resolveWallTime } from "../../../src/index";
import type { ZoneCache } from "../../../src/index";
import { adversarialZoneList, hourlyWallTimes } from "../../support/sweep";

const transitionDays = [
  { month: 3, day: 29 },
  { month: 4, day: 5 },
  { month: 9, day: 27 },
  { month: 10, day: 25 },
  { month: 11, day: 1 },
] as const;

const foldOffendersOnDay = (
  zone: ZoneId,
  zones: ZoneCache,
  month: number,
  day: number,
): readonly string[] => {
  const offenders: string[] = [];
  for (const wall of hourlyWallTimes(2026, month, day)) {
    const resolution = resolveWallTime({ kind: "wallTime", value: wall }, zone, zones);
    if (resolution.kind !== "fold") {
      continue;
    }
    if (Date.parse(resolution.instant.value) >= Date.parse(resolution.discarded.value)) {
      offenders.push(`${zone.value}@${wall}`);
    }
  }
  return offenders;
};

const foldOffenders = (zones: ZoneCache): readonly string[] =>
  adversarialZoneList.flatMap((value) =>
    transitionDays.flatMap((slot) =>
      foldOffendersOnDay({ kind: "zoneId", value }, zones, slot.month, slot.day),
    ),
  );

describe("every wall time a zone renders twice", () => {
  test("ICAL-I20: the fold resolves to the earlier of the two instants and names the discarded one", () => {
    expect(foldOffenders(createZoneCache())).toEqual([]);
  });
});
