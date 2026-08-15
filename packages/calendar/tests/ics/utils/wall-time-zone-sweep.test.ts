import { describe, expect, it } from "vitest";
import {
  getTimeZoneOffsetMinutes,
  instantToWallTime,
  wallTimeToInstant,
} from "../../../src/ics/utils/timezone-instant";
import { sweepTimeZones } from "./tz-sweep-support";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const SWEEP_TIMEOUT_MS = 300_000;

interface ZoneTransition {
  instant: number;
  offsetFromMs: number;
  offsetToMs: number;
}

const offsetMilliseconds = (instant: number, timeZone: string): number =>
  instantToWallTime(new Date(instant), timeZone).getTime() - instant;

const findTransitionInstant = (
  lowerBound: number,
  upperBound: number,
  timeZone: string,
  offsetFromMs: number,
): number => {
  let lower = lowerBound;
  let upper = upperBound;
  while (upper - lower > 1) {
    const midpoint = Math.floor((lower + upper) / 2);
    if (offsetMilliseconds(midpoint, timeZone) === offsetFromMs) {
      lower = midpoint;
    } else {
      upper = midpoint;
    }
  }
  return upper;
};

const collectTransitions = (timeZone: string, from: number, to: number): ZoneTransition[] => {
  const transitions: ZoneTransition[] = [];
  let previousSample = from;
  let previousOffset = offsetMilliseconds(from, timeZone);

  for (let sample = from + MS_PER_DAY; sample <= to; sample += MS_PER_DAY) {
    const offset = offsetMilliseconds(sample, timeZone);
    if (offset !== previousOffset) {
      transitions.push({
        instant: findTransitionInstant(previousSample, sample, timeZone, previousOffset),
        offsetFromMs: previousOffset,
        offsetToMs: offset,
      });
      previousOffset = offset;
    }
    previousSample = sample;
  }

  return transitions;
};

const wallTimeIsRepresentable = (
  wallTime: number,
  expected: number,
  transition: ZoneTransition,
): boolean => {
  if (expected < transition.instant) {
    return expected === wallTime - transition.offsetFromMs;
  }
  return expected === wallTime - transition.offsetToMs;
};

const resolveExpectedInstant = (wallTime: number, transition: ZoneTransition): number => {
  const beforeCandidate = wallTime - transition.offsetFromMs;
  const afterCandidate = wallTime - transition.offsetToMs;
  const beforeIsValid = beforeCandidate < transition.instant;
  const afterIsValid = afterCandidate >= transition.instant;

  if (beforeIsValid && afterIsValid) {
    return Math.min(beforeCandidate, afterCandidate);
  }
  if (beforeIsValid) {
    return beforeCandidate;
  }
  if (afterIsValid) {
    return afterCandidate;
  }
  return beforeCandidate;
};

const WALL_TIME_OFFSETS_MINUTES = [-180, -90, -60, -30, -1, 0, 1, 30, 60, 90, 180];

const collectWallTimes = (transition: ZoneTransition): number[] => {
  const wallTimes = new Set<number>();
  for (const minutes of WALL_TIME_OFFSETS_MINUTES) {
    wallTimes.add(transition.instant + transition.offsetFromMs + minutes * MS_PER_MINUTE);
    wallTimes.add(transition.instant + transition.offsetToMs + minutes * MS_PER_MINUTE);
  }
  return [...wallTimes];
};

interface SweepOutcome {
  checked: number;
  mismatches: string[];
  zonesWithTransitions: number;
}

const sweep = (timeZones: string[], from: number, to: number): SweepOutcome => {
  const mismatches: string[] = [];
  let checked = 0;
  let zonesWithTransitions = 0;

  for (const timeZone of timeZones) {
    const transitions = collectTransitions(timeZone, from, to);
    if (transitions.length > 0) {
      zonesWithTransitions += 1;
    }

    for (const transition of transitions) {
      for (const wallTime of collectWallTimes(transition)) {
        checked += 1;
        const expected = resolveExpectedInstant(wallTime, transition);
        const actual = wallTimeToInstant(new Date(wallTime), timeZone).getTime();
        if (actual !== expected) {
          mismatches.push(
            `${timeZone} wall=${new Date(wallTime).toISOString()} `
            + `transition=${new Date(transition.instant).toISOString()} `
            + `expected=${new Date(expected).toISOString()} actual=${new Date(actual).toISOString()}`,
          );
          continue;
        }
        const readBack = instantToWallTime(new Date(actual), timeZone).getTime();
        const wallTimeExists = wallTimeIsRepresentable(wallTime, expected, transition);
        if (wallTimeExists && readBack !== wallTime) {
          mismatches.push(
            `${timeZone} round trip wall=${new Date(wallTime).toISOString()} `
            + `read back as ${new Date(readBack).toISOString()}`,
          );
        }
      }
    }
  }

  return { checked, mismatches, zonesWithTransitions };
};

const ALL_TIME_ZONES = Intl.supportedValuesOf("timeZone");

describe("resolving a wall time near every transition IANA declares", () => {
  it("names the same instant a two-offset derivation does, in every zone", () => {
    const outcome = sweep(
      ALL_TIME_ZONES,
      Date.UTC(2024, 0, 1),
      Date.UTC(2032, 0, 1),
    );

    expect(outcome.mismatches).toEqual([]);
    expect(outcome.zonesWithTransitions).toBeGreaterThan(100);
    expect(outcome.checked).toBeGreaterThan(10_000);
  }, SWEEP_TIMEOUT_MS);

  it("holds for the historical offsets carrying whole minutes and seconds", () => {
    const outcome = sweep(
      [
        "Africa/Monrovia",
        "America/St_Johns",
        "Asia/Kolkata",
        "Asia/Kathmandu",
        "Australia/Lord_Howe",
        "Europe/Amsterdam",
        "Europe/Dublin",
        "Europe/Lisbon",
        "Europe/Moscow",
        "Pacific/Apia",
        "Pacific/Chatham",
      ],
      Date.UTC(1901, 0, 1),
      Date.UTC(1980, 0, 1),
    );

    expect(outcome.mismatches).toEqual([]);
    expect(outcome.checked).toBeGreaterThan(1000);
  }, SWEEP_TIMEOUT_MS);

  it("finds no zone that changes offset twice within two days", () => {
    const closePairs: string[] = [];

    for (const timeZone of sweepTimeZones()) {
      const transitions = collectTransitions(timeZone, Date.UTC(1970, 0, 1), Date.UTC(2038, 0, 1));
      for (let index = 1; index < transitions.length; index += 1) {
        const previous = transitions[index - 1];
        const current = transitions[index];
        if (previous && current && current.instant - previous.instant < 2 * MS_PER_DAY) {
          closePairs.push(`${timeZone} ${new Date(current.instant).toISOString()}`);
        }
      }
    }

    expect(closePairs).toEqual([]);
  }, SWEEP_TIMEOUT_MS);
});

describe("a dense sweep of instants through the wall clock and back", () => {
  const ZONES = [
    "America/New_York",
    "America/Santiago",
    "Antarctica/Troll",
    "Asia/Beirut",
    "Australia/Lord_Howe",
    "Europe/Berlin",
    "Pacific/Chatham",
  ];

  it("returns the instant it was given outside a fold and never a later one", () => {
    const drifted: string[] = [];

    for (const timeZone of ZONES) {
      for (
        let instant = Date.UTC(2027, 0, 1);
        instant < Date.UTC(2028, 0, 1);
        instant += 17 * MS_PER_MINUTE
      ) {
        const wallTime = instantToWallTime(new Date(instant), timeZone);
        const resolved = wallTimeToInstant(wallTime, timeZone).getTime();
        if (resolved > instant) {
          drifted.push(`${timeZone} ${new Date(instant).toISOString()} moved forward`);
          continue;
        }
        if (instantToWallTime(new Date(resolved), timeZone).getTime() !== wallTime.getTime()) {
          drifted.push(`${timeZone} ${new Date(instant).toISOString()} lost its wall time`);
        }
      }
    }

    expect(drifted).toEqual([]);
  }, SWEEP_TIMEOUT_MS);

  it("reports an offset in whole minutes for every instant it resolves", () => {
    const offsets = new Set<number>();
    for (const timeZone of ZONES) {
      for (
        let instant = Date.UTC(2027, 0, 1);
        instant < Date.UTC(2027, 3, 1);
        instant += 6 * MS_PER_HOUR
      ) {
        offsets.add(getTimeZoneOffsetMinutes(new Date(instant), timeZone));
      }
    }

    expect([...offsets].every((offset) => Number.isInteger(offset))).toBe(true);
  });
});
