import { describe, expect, test } from "vitest";
import { createZoneCache, instantToWallTime, resolveWallTime } from "../../src/index";
import { instant } from "../support/feed";

const berlin = { kind: "zoneId", value: "Europe/Berlin" } as const;
const lordHowe = { kind: "zoneId", value: "Australia/Lord_Howe" } as const;
const wall = (value: string) => ({ kind: "wallTime", value }) as const;

describe("resolving a wall time to an instant", () => {
  test("ICAL-I20: a wall time the zone renders once resolves uniquely", () => {
    expect(resolveWallTime(wall("20260615T120000"), berlin, createZoneCache())).toEqual({
      kind: "unique",
      instant: instant("2026-06-15T10:00:00.000Z"),
    });
  });

  test("ICAL-I20: a fall-back hour resolves to the earlier instant and names the one it discarded", () => {
    const resolution = resolveWallTime(wall("20261025T023000"), berlin, createZoneCache());

    expect(resolution.kind).toBe("fold");
    if (resolution.kind !== "fold") {
      return;
    }
    expect(resolution.instant.value).toBe("2026-10-25T00:30:00.000Z");
    expect(resolution.discarded.value).toBe("2026-10-25T01:30:00.000Z");
  });

  test("ICAL-I20: a spring-forward gap shifts forward by the size of the gap that removed it", () => {
    const resolution = resolveWallTime(wall("20260329T023000"), berlin, createZoneCache());

    expect(resolution.kind).toBe("gap");
    if (resolution.kind !== "gap") {
      return;
    }
    expect(resolution.shiftMinutes).toBe(60);
    expect(resolution.instant.value).toBe("2026-03-29T01:30:00.000Z");
  });

  test("ICAL-I20: a half-hour gap in Lord Howe shifts by thirty minutes, not by an hour", () => {
    const resolution = resolveWallTime(wall("20261004T020000"), lordHowe, createZoneCache());

    expect(resolution.kind).toBe("gap");
    if (resolution.kind !== "gap") {
      return;
    }
    expect(resolution.shiftMinutes).toBe(30);
  });

  test("ICAL-I45: the resolution never reads the ambient timezone", () => {
    const zones = createZoneCache();
    const before = resolveWallTime(wall("20260615T120000"), berlin, zones);
    const previousTz = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati";
    const after = resolveWallTime(wall("20260615T120000"), berlin, zones);
    process.env.TZ = previousTz;

    expect(after).toEqual(before);
  });

  test("ICAL-I20: an instant rendered to wall time and back returns the instant that rendered it", () => {
    const zones = createZoneCache();
    const source = instant("2026-06-15T10:00:00.000Z");
    const rendered = instantToWallTime(source, berlin, zones);
    const resolution = resolveWallTime(rendered, berlin, zones);

    expect(resolution.instant.value).toBe(source.value);
  });
});
