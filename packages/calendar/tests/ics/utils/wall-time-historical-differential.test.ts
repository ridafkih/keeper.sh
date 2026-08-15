import { describe, expect, it } from "vitest";
import { instantToWallTime, wallTimeToInstant } from "../../../src/ics/utils/timezone-instant";
import { sweepTimeZones } from "./tz-sweep-support";

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const SUITE_TIMEOUT_MS = 600_000;

const HISTORICAL_START = Date.UTC(1925, 0, 1);
const HISTORICAL_END = Date.UTC(2015, 0, 1);
const DAILY_STEP_MS = MS_PER_DAY;

const SWEEP_RADIUS_MS = 30 * MS_PER_HOUR;
const SWEEP_STEP_MS = 5 * MS_PER_MINUTE;

const ZONES = sweepTimeZones();

interface Transition {
  from: number;
  instant: number;
  to: number;
}

const offsetAt = (instant: number, timeZone: string): number =>
  instantToWallTime(new Date(instant), timeZone).getTime() - instant;

const refineTransition = (
  lower: number,
  upper: number,
  timeZone: string,
  offsetBefore: number,
): number => {
  let low = lower;
  let high = upper;
  while (high - low > 1) {
    const midpoint = Math.floor((low + high) / 2);
    if (offsetAt(midpoint, timeZone) === offsetBefore) {
      low = midpoint;
    } else {
      high = midpoint;
    }
  }
  return high;
};

const scanTransitions = (
  timeZone: string,
  start: number,
  end: number,
  step: number,
): Transition[] => {
  const transitions: Transition[] = [];
  let previousSample = start;
  let previousOffset = offsetAt(start, timeZone);

  for (let sample = start + step; sample <= end; sample += step) {
    const offset = offsetAt(sample, timeZone);
    if (offset !== previousOffset) {
      transitions.push({
        from: previousOffset,
        instant: refineTransition(previousSample, sample, timeZone, previousOffset),
        to: offset,
      });
      previousOffset = offset;
    }
    previousSample = sample;
  }

  return transitions;
};

const historicalTransitions = new Map<string, Transition[]>(
  ZONES.map((timeZone) => [
    timeZone,
    scanTransitions(timeZone, HISTORICAL_START, HISTORICAL_END, DAILY_STEP_MS),
  ]),
);

const resolveByExhaustiveSweep = (wallTime: number, timeZone: string): number => {
  const offsets = new Set<number>();
  for (
    let probe = wallTime - SWEEP_RADIUS_MS;
    probe <= wallTime + SWEEP_RADIUS_MS;
    probe += SWEEP_STEP_MS
  ) {
    offsets.add(offsetAt(probe, timeZone));
  }

  const valid = [...offsets]
    .map((offset) => wallTime - offset)
    .filter((candidate) => offsetAt(candidate, timeZone) === wallTime - candidate);
  if (valid.length > 0) {
    return Math.min(...valid);
  }

  const localTransitions = scanTransitions(
    timeZone,
    wallTime - SWEEP_RADIUS_MS,
    wallTime + SWEEP_RADIUS_MS,
    SWEEP_STEP_MS,
  );
  const gap = localTransitions.find((transition) =>
    transition.to > transition.from
    && wallTime >= transition.instant + transition.from
    && wallTime < transition.instant + transition.to);
  if (!gap) {
    throw new Error(`No instant and no gap explains ${new Date(wallTime).toISOString()} in ${timeZone}`);
  }
  return wallTime - gap.from;
};

const PROBE_DELTAS_MS = [
  -49 * MS_PER_HOUR,
  -25 * MS_PER_HOUR,
  -24 * MS_PER_HOUR,
  -MS_PER_HOUR,
  -1,
  0,
  1,
  MS_PER_HOUR,
  24 * MS_PER_HOUR,
  25 * MS_PER_HOUR,
  49 * MS_PER_HOUR,
];

describe("resolving a wall time in the historical half of tzdata", () => {
  it("resolves every wall time around every transition since 1925 back to the instant that renders it", () => {
    const failures: string[] = [];

    for (const [timeZone, transitions] of historicalTransitions) {
      for (const transition of transitions) {
        for (const delta of PROBE_DELTAS_MS) {
          const instant = transition.instant + delta;
          const wallTime = instantToWallTime(new Date(instant), timeZone).getTime();
          const resolved = wallTimeToInstant(new Date(wallTime), timeZone).getTime();
          const rendered = instantToWallTime(new Date(resolved), timeZone).getTime();
          if (rendered !== wallTime) {
            failures.push(
              `${timeZone}: wall ${new Date(wallTime).toISOString()} resolved to ${new Date(resolved).toISOString()}, which renders as ${new Date(rendered).toISOString()}`,
            );
            continue;
          }
          if (resolved > instant) {
            failures.push(
              `${timeZone}: wall ${new Date(wallTime).toISOString()} resolved to ${new Date(resolved).toISOString()}, later than ${new Date(instant).toISOString()}`,
            );
          }
        }
      }
    }

    expect(failures.slice(0, 20)).toEqual([]);
  }, SUITE_TIMEOUT_MS);

  it("never brackets a wall time with two transitions inside the same two days", () => {
    const close: string[] = [];

    for (const [timeZone, transitions] of historicalTransitions) {
      for (const [index, transition] of transitions.entries()) {
        const previous = transitions[index - 1];
        if (previous && transition.instant - previous.instant < 2 * MS_PER_DAY) {
          close.push(
            `${timeZone}: ${new Date(previous.instant).toISOString()} then ${new Date(transition.instant).toISOString()}`,
          );
        }
      }
    }

    expect(close).toEqual([]);
  }, SUITE_TIMEOUT_MS);
});

const createRandom = (seed: number): (() => number) => {
  let state = seed % 4_294_967_296;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
};

const RANDOM_SAMPLES_PER_ZONE = 4;
const RANDOM_RANGE_START = Date.UTC(1900, 0, 1);
const RANDOM_RANGE_END = Date.UTC(2045, 0, 1);

describe("resolving an arbitrary wall time in an arbitrary zone", () => {
  it("agrees with an exhaustive sweep on seeded random samples", () => {
    const random = createRandom(24_301);
    const failures: string[] = [];

    for (const timeZone of ZONES) {
      for (let sample = 0; sample < RANDOM_SAMPLES_PER_ZONE; sample += 1) {
        const instant = Math.floor(
          RANDOM_RANGE_START + random() * (RANDOM_RANGE_END - RANDOM_RANGE_START),
        );
        const wallTime = instantToWallTime(new Date(instant), timeZone).getTime();
        const resolved = wallTimeToInstant(new Date(wallTime), timeZone).getTime();
        const expected = resolveByExhaustiveSweep(wallTime, timeZone);
        if (resolved !== expected) {
          failures.push(
            `${timeZone}: wall ${new Date(wallTime).toISOString()} resolved to ${new Date(resolved).toISOString()}, sweep says ${new Date(expected).toISOString()}`,
          );
        }
      }
    }

    expect(failures.slice(0, 20)).toEqual([]);
  }, SUITE_TIMEOUT_MS);
});

const PATHOLOGICAL_ZONES = [
  "Africa/Cairo",
  "Africa/Casablanca",
  "America/Havana",
  "America/Santiago",
  "Asia/Amman",
  "Asia/Damascus",
  "Asia/Gaza",
  "Asia/Kathmandu",
  "Asia/Tehran",
  "Australia/Lord_Howe",
  "Pacific/Apia",
  "Pacific/Chatham",
  "Pacific/Kiritimati",
];

describe("a zone whose history holds a skipped day or a fractional-hour step", () => {
  it("resolves every hourly wall time it renders back to the instant that renders it", () => {
    const failures: string[] = [];

    for (const timeZone of PATHOLOGICAL_ZONES) {
      const transitions = scanTransitions(
        timeZone,
        Date.UTC(1900, 0, 1),
        Date.UTC(2045, 0, 1),
        MS_PER_DAY,
      );
      for (const transition of transitions) {
        for (let hour = -36; hour <= 36; hour += 1) {
          const instant = transition.instant + hour * MS_PER_HOUR;
          const wallTime = instantToWallTime(new Date(instant), timeZone).getTime();
          const resolved = wallTimeToInstant(new Date(wallTime), timeZone).getTime();
          const rendered = instantToWallTime(new Date(resolved), timeZone).getTime();
          if (rendered !== wallTime) {
            failures.push(
              `${timeZone}: wall ${new Date(wallTime).toISOString()} resolved to ${new Date(resolved).toISOString()}, which renders as ${new Date(rendered).toISOString()}`,
            );
            continue;
          }
          if (resolved > instant) {
            failures.push(
              `${timeZone}: wall ${new Date(wallTime).toISOString()} resolved to ${new Date(resolved).toISOString()}, later than ${new Date(instant).toISOString()}`,
            );
          }
        }
      }
    }

    expect(failures.slice(0, 20)).toEqual([]);
  }, SUITE_TIMEOUT_MS);
});
