import { describe, expect, it } from "vitest";
import {
  findTimeZoneTransitions,
  formatIcsUtcOffset,
  getTimeZoneOffsetMinutes,
  instantToWallTime,
  wallTimeToInstant,
} from "../../../src/ics/utils/timezone-instant";

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

const WINDOW_START = new Date("2024-01-01T00:00:00.000Z");
const WINDOW_END = new Date("2030-01-01T00:00:00.000Z");

const ZONES = [
  "UTC",
  "America/New_York",
  "America/Havana",
  "America/Santiago",
  "America/Asuncion",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Asia/Beirut",
  "Asia/Jerusalem",
  "Asia/Kathmandu",
  "Asia/Tehran",
  "Africa/Casablanca",
  "Antarctica/Troll",
  "Australia/Lord_Howe",
  "Australia/Sydney",
  "Pacific/Chatham",
  "Pacific/Auckland",
];

const PROBE_OFFSETS_MS = [
  -2 * MS_PER_HOUR,
  -MS_PER_HOUR,
  -30 * MS_PER_MINUTE,
  -MS_PER_MINUTE,
  -1,
  0,
  1,
  MS_PER_MINUTE,
  30 * MS_PER_MINUTE,
  MS_PER_HOUR,
  2 * MS_PER_HOUR,
];

interface Failure {
  instant: string;
  reason: string;
  resolved: string;
  timeZone: string;
  wallTime: string;
}

const checkInstant = (instant: Date, timeZone: string): Failure | undefined => {
  const wallTime = instantToWallTime(instant, timeZone);
  const resolved = wallTimeToInstant(wallTime, timeZone);
  const resolvedWallTime = instantToWallTime(resolved, timeZone);
  const describe_ = (reason: string): Failure => ({
    instant: instant.toISOString(),
    reason,
    resolved: resolved.toISOString(),
    timeZone,
    wallTime: wallTime.toISOString(),
  });

  if (resolvedWallTime.getTime() !== wallTime.getTime()) {
    return describe_(`resolved instant renders as ${resolvedWallTime.toISOString()}`);
  }
  if (resolved.getTime() > instant.getTime()) {
    return describe_("resolved instant is later than the earliest match");
  }
  return globalThis.undefined;
};

const collectTransitionProbes = (timeZone: string): Date[] => {
  const transitions = findTimeZoneTransitions(timeZone, WINDOW_START, WINDOW_END);
  return transitions.flatMap((transition) =>
    PROBE_OFFSETS_MS.map((offset) => new Date(transition.instant.getTime() + offset)));
};

describe("wall time and instant round trip across zones", () => {
  for (const timeZone of ZONES) {
    it(`resolves every wall time around a transition in ${timeZone}`, () => {
      const failures = collectTransitionProbes(timeZone)
        .flatMap((instant) => checkInstant(instant, timeZone) ?? []);
      expect(failures).toEqual([]);
    });
  }

  it("resolves a dense sweep of a full year in a fold-heavy zone", () => {
    const timeZone = "America/New_York";
    const start = Date.UTC(2027, 0, 1);
    const end = Date.UTC(2028, 0, 1);
    const step = 37 * MS_PER_MINUTE;
    const failures: Failure[] = [];
    for (let time = start; time < end; time += step) {
      const failure = checkInstant(new Date(time), timeZone);
      if (failure) {
        failures.push(failure);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("wall times a zone never renders", () => {
  it("shifts a spring-forward gap wall time to the first instant after it", () => {
    const wallTime = new Date(Date.UTC(2027, 2, 14, 2, 30));
    const resolved = wallTimeToInstant(wallTime, "America/New_York");
    expect(resolved.toISOString()).toBe("2027-03-14T07:30:00.000Z");
    expect(instantToWallTime(resolved, "America/New_York").toISOString())
      .toBe("2027-03-14T03:30:00.000Z");
  });

  it("shifts a half-hour gap wall time in Lord Howe", () => {
    const wallTime = new Date(Date.UTC(2027, 9, 3, 2, 15));
    const resolved = wallTimeToInstant(wallTime, "Australia/Lord_Howe");
    expect(instantToWallTime(resolved, "Australia/Lord_Howe").getTime())
      .toBeGreaterThan(wallTime.getTime());
    expect(instantToWallTime(resolved, "Australia/Lord_Howe").getTime() - wallTime.getTime())
      .toBe(30 * MS_PER_MINUTE);
  });

  it("resolves a wall time on a day a midnight transition removes", () => {
    const transitions = findTimeZoneTransitions(
      "America/Santiago",
      new Date("2027-08-01T00:00:00.000Z"),
      new Date("2027-10-01T00:00:00.000Z"),
    );
    const [transition] = transitions;
    expect(transition).toBeDefined();
    const missingWallTime = instantToWallTime(
      new Date((transition?.instant.getTime() ?? 0) - MS_PER_MINUTE),
      "America/Santiago",
    );
    const skipped = new Date(missingWallTime.getTime() + MS_PER_MINUTE);
    const resolved = wallTimeToInstant(skipped, "America/Santiago");
    expect(instantToWallTime(resolved, "America/Santiago").getTime())
      .toBeGreaterThanOrEqual(skipped.getTime());
  });
});

describe("wall times a zone renders twice", () => {
  it("returns the earlier of the two instants in a fall-back hour", () => {
    const wallTime = new Date(Date.UTC(2027, 10, 7, 1, 30));
    const resolved = wallTimeToInstant(wallTime, "America/New_York");
    expect(resolved.toISOString()).toBe("2027-11-07T05:30:00.000Z");
  });

  it("returns the earlier instant for a fold that repeats midnight", () => {
    const transitions = findTimeZoneTransitions(
      "America/Havana",
      new Date("2027-10-01T00:00:00.000Z"),
      new Date("2027-12-01T00:00:00.000Z"),
    );
    const [transition] = transitions;
    expect(transition).toBeDefined();
    const secondPass = new Date((transition?.instant.getTime() ?? 0) + 30 * MS_PER_MINUTE);
    const wallTime = instantToWallTime(secondPass, "America/Havana");
    const resolved = wallTimeToInstant(wallTime, "America/Havana");
    expect(resolved.getTime()).toBeLessThan(secondPass.getTime());
    expect(instantToWallTime(resolved, "America/Havana").getTime()).toBe(wallTime.getTime());
  });
});

describe("offset formatting", () => {
  it("formats a quarter-hour zone offset", () => {
    expect(formatIcsUtcOffset(getTimeZoneOffsetMinutes(
      new Date("2027-06-01T00:00:00.000Z"),
      "Asia/Kathmandu",
    ))).toBe("+0545");
  });

  it("formats a negative half-hour zone offset", () => {
    expect(formatIcsUtcOffset(getTimeZoneOffsetMinutes(
      new Date("2027-06-01T00:00:00.000Z"),
      "America/St_Johns",
    ))).toBe("-0230");
  });
});
