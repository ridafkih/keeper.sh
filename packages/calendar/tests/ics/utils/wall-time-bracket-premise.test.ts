import { describe, expect, it } from "vitest";
import { instantToWallTime, wallTimeToInstant } from "../../../src/ics/utils/timezone-instant";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const SCAN_STEP_MS = 6 * MS_PER_HOUR;
const SCAN_START = Date.UTC(2015, 0, 1);
const SCAN_END = Date.UTC(2045, 0, 1);
const SUITE_TIMEOUT_MS = 300_000;

const ZONES = Intl.supportedValuesOf("timeZone");

interface Transition {
  from: number;
  instant: number;
  to: number;
}

const offsetAt = (instant: number, timeZone: string): number =>
  instantToWallTime(new Date(instant), timeZone).getTime() - instant;

const findTransitions = (timeZone: string): Transition[] => {
  const transitions: Transition[] = [];
  let previousOffset = offsetAt(SCAN_START, timeZone);
  let previousSample = SCAN_START;

  for (let sample = SCAN_START + SCAN_STEP_MS; sample <= SCAN_END; sample += SCAN_STEP_MS) {
    const offset = offsetAt(sample, timeZone);
    if (offset !== previousOffset) {
      let lower = previousSample;
      let upper = sample;
      while (upper - lower > 1) {
        const midpoint = Math.floor((lower + upper) / 2);
        if (offsetAt(midpoint, timeZone) === previousOffset) {
          lower = midpoint;
        } else {
          upper = midpoint;
        }
      }
      transitions.push({ from: previousOffset, instant: upper, to: offset });
      previousOffset = offset;
    }
    previousSample = sample;
  }

  return transitions;
};

const transitionsByZone = new Map<string, Transition[]>(
  ZONES.map((timeZone) => [timeZone, findTransitions(timeZone)]),
);

// Asserts a property of the runtime tzdata, not of this codebase: no zone transitions twice within a day.
describe("the bracket the two-probe wall-time resolution rests on", () => {
  it("finds no zone that transitions twice within two days", () => {
    const close: string[] = [];

    for (const [timeZone, transitions] of transitionsByZone) {
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

const PROBE_DELTAS_MS = [
  -49 * MS_PER_HOUR,
  -25 * MS_PER_HOUR,
  -24 * MS_PER_HOUR,
  -23 * MS_PER_HOUR,
  -1,
  0,
  1,
  23 * MS_PER_HOUR,
  24 * MS_PER_HOUR,
  25 * MS_PER_HOUR,
  49 * MS_PER_HOUR,
];

describe("every wall time every IANA zone renders", () => {
  it("resolves to the earliest instant the zone renders as that wall time", () => {
    const failures: string[] = [];

    for (const [timeZone, transitions] of transitionsByZone) {
      for (const transition of transitions) {
        for (const delta of PROBE_DELTAS_MS) {
          const instant = transition.instant + delta;
          const wallTime = instantToWallTime(new Date(instant), timeZone);
          const resolved = wallTimeToInstant(wallTime, timeZone);
          const rendered = instantToWallTime(resolved, timeZone);
          if (rendered.getTime() !== wallTime.getTime()) {
            failures.push(
              `${timeZone}: ${wallTime.toISOString()} resolved to ${resolved.toISOString()}, which renders as ${rendered.toISOString()}`,
            );
            continue;
          }
          if (resolved.getTime() > instant) {
            failures.push(
              `${timeZone}: ${wallTime.toISOString()} resolved to ${resolved.toISOString()}, later than ${new Date(instant).toISOString()}`,
            );
          }
        }
      }
    }

    expect(failures).toEqual([]);
  }, SUITE_TIMEOUT_MS);
});

describe("every wall time every IANA zone skips", () => {
  it("shifts forward by the size of the gap that removed it", () => {
    const failures: string[] = [];

    for (const [timeZone, transitions] of transitionsByZone) {
      for (const transition of transitions) {
        if (transition.to <= transition.from) {
          continue;
        }
        const gapStart = transition.instant + transition.from;
        const gapSize = transition.to - transition.from;
        for (const inset of [1, Math.floor(gapSize / 2), gapSize - 1]) {
          const wallTime = new Date(gapStart + inset);
          const resolved = wallTimeToInstant(wallTime, timeZone);
          const rendered = instantToWallTime(resolved, timeZone);
          if (resolved.getTime() !== wallTime.getTime() - transition.from) {
            failures.push(
              `${timeZone}: skipped ${wallTime.toISOString()} resolved to ${resolved.toISOString()}`,
            );
            continue;
          }
          if (rendered.getTime() - wallTime.getTime() !== gapSize) {
            failures.push(
              `${timeZone}: skipped ${wallTime.toISOString()} rendered as ${rendered.toISOString()}, not shifted by the gap`,
            );
          }
        }
      }
    }

    expect(failures).toEqual([]);
  }, SUITE_TIMEOUT_MS);
});
