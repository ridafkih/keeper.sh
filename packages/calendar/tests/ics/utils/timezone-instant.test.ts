import { describe, expect, it } from "vitest";
import {
  ianaOffsetAt,
  instantToWallTime,
  wallTimeToInstant,
  wallTimeToInstantWith,
} from "../../../src/ics/utils/timezone-instant";
import type { ZoneOffsetAt } from "../../../src/ics/utils/timezone-instant";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const QUARTER_HOUR_MS = 15 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const stepOffsetAt = (
  transition: string,
  offsetBeforeMinutes: number,
  offsetAfterMinutes: number,
): ZoneOffsetAt => {
  const transitionTime = new Date(transition).getTime();
  return (instant) => {
    if (instant.getTime() < transitionTime) {
      return offsetBeforeMinutes;
    }
    return offsetAfterMinutes;
  };
};

const constantOffsetAt = (offsetMinutes: number): ZoneOffsetAt => () => offsetMinutes;

const resolve = (wallTime: string, offsetAt: ZoneOffsetAt): string =>
  wallTimeToInstantWith(new Date(wallTime), offsetAt).toISOString();

const quarterHourWallTimes = (day: string): Date[] => {
  const start = new Date(`${day}T00:00:00.000Z`).getTime();
  return Array.from(
    { length: MS_PER_DAY / QUARTER_HOUR_MS },
    (_unused, index) => new Date(start + index * QUARTER_HOUR_MS),
  );
};

describe("timezone instant conversion", () => {
  it("shifts a nonexistent DST-gap wall time forward by the transition", () => {
    const instant = wallTimeToInstant(
      new Date("2026-03-08T02:30:00.000Z"),
      "America/New_York",
    );

    expect(instant.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(instantToWallTime(instant, "America/New_York").toISOString())
      .toBe("2026-03-08T03:30:00.000Z");
  });

  it("chooses the earlier instant for an ambiguous DST-fold wall time", () => {
    const instant = wallTimeToInstant(
      new Date("2026-11-01T01:30:00.000Z"),
      "America/New_York",
    );

    expect(instant.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(instantToWallTime(instant, "America/New_York").toISOString())
      .toBe("2026-11-01T01:30:00.000Z");
  });
});

describe("wallTimeToInstantWith", () => {
  const springForward = stepOffsetAt("2026-03-08T09:00:00.000Z", -420, -360);
  const fallBack = stepOffsetAt("2026-11-01T08:00:00.000Z", -360, -420);

  it("shifts a gap wall time forward by the pre-transition offset", () => {
    expect(resolve("2026-03-08T02:30:00.000Z", springForward))
      .toBe("2026-03-08T09:30:00.000Z");
  });

  it("resolves wall times far from the transition to their single instant", () => {
    expect(resolve("2026-03-01T12:00:00.000Z", springForward))
      .toBe("2026-03-01T19:00:00.000Z");
    expect(resolve("2026-03-15T12:00:00.000Z", springForward))
      .toBe("2026-03-15T18:00:00.000Z");
  });

  it("chooses the earlier instant for a fold wall time", () => {
    expect(resolve("2026-11-01T01:30:00.000Z", fallBack))
      .toBe("2026-11-01T07:30:00.000Z");
  });

  it("keeps sub-minute offsets exact instead of rounding them", () => {
    expect(resolve("1960-06-01T12:00:00.000Z", constantOffsetAt(-44.5)))
      .toBe("1960-06-01T12:44:30.000Z");
    expect(resolve("1920-06-01T12:00:00.000Z", constantOffsetAt(19 + 32 / 60)))
      .toBe("1920-06-01T11:40:28.000Z");
  });

  it("throws a RangeError naming the wall time when no candidate checks out", () => {
    const wallTime = new Date("2026-06-15T12:00:00.000Z");
    const wallTimeMs = wallTime.getTime();
    const inconsistent: ZoneOffsetAt = (instant) => {
      if (instant.getTime() < wallTimeMs - 12 * MS_PER_HOUR) {
        return 120;
      }
      if (instant.getTime() > wallTimeMs + 12 * MS_PER_HOUR) {
        return 60;
      }
      return 0;
    };

    expect(() => wallTimeToInstantWith(wallTime, inconsistent)).toThrow(RangeError);
    expect(() => wallTimeToInstantWith(wallTime, inconsistent))
      .toThrow(`Unable to resolve wall time ${wallTime.toISOString()}`);
  });
});

describe("ianaOffsetAt", () => {
  it("reports minutes east of UTC without rounding", () => {
    expect(ianaOffsetAt("America/Denver")(new Date("2026-01-15T12:00:00.000Z"))).toBe(-420);
    expect(ianaOffsetAt("America/Denver")(new Date("2026-07-15T12:00:00.000Z"))).toBe(-360);
    expect(ianaOffsetAt("Africa/Monrovia")(new Date("1960-06-01T12:00:00.000Z"))).toBe(-44.5);
  });
});

describe("wallTimeToInstant parity with an IANA offset source", () => {
  const transitionDays: [string, string][] = [
    ["America/Denver", "2026-03-08"],
    ["America/Denver", "2026-11-01"],
    ["America/Edmonton", "2026-11-01"],
    ["Australia/Lord_Howe", "2026-04-05"],
    ["Australia/Lord_Howe", "2026-10-04"],
  ];

  it.each(transitionDays)("agrees every quarter hour in %s on %s", (timeZone, day) => {
    const offsetAt = ianaOffsetAt(timeZone);
    for (const wallTime of quarterHourWallTimes(day)) {
      expect(
        wallTimeToInstantWith(wallTime, offsetAt).toISOString(),
        wallTime.toISOString(),
      ).toBe(wallTimeToInstant(wallTime, timeZone).toISOString());
    }
  });

  it.each([
    ["Europe/Amsterdam", "1920-06-01T12:00:00.000Z"],
    ["Africa/Monrovia", "1960-06-01T12:00:00.000Z"],
  ])("agrees on the sub-minute historical offset of %s", (timeZone, wallTime) => {
    const wall = new Date(wallTime);
    expect(wallTimeToInstantWith(wall, ianaOffsetAt(timeZone)).getTime())
      .toBe(wallTimeToInstant(wall, timeZone).getTime());
  });
});
