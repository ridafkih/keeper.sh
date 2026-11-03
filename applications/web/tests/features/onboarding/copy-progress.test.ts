import { describe, expect, it } from "vitest";
import {
  advanceCopyProgress,
  describeRemainingEvents,
  describeTimeLeft,
  resolveCopyPercent,
} from "../../../src/features/onboarding/copy-progress";
import type { CopyProgress, CopyProgressSignal } from "../../../src/features/onboarding/copy-progress";

const signal = (overrides: Partial<CopyProgressSignal> = {}): CopyProgressSignal => ({
  syncEventsRemaining: 0,
  syncEventsTotal: 0,
  syncSecondsRemaining: null,
  ...overrides,
});

describe("advanceCopyProgress", () => {
  it("knows nothing before the first run has counted its operations", () => {
    expect(advanceCopyProgress(null, signal())).toBeNull();
  });

  it("follows the remaining operations and estimate the server pushes", () => {
    const progress = advanceCopyProgress(null, signal({
      syncEventsRemaining: 900,
      syncEventsTotal: 1200,
      syncSecondsRemaining: 180,
    }));

    expect(progress).toEqual({ remaining: 900, secondsRemaining: 180, total: 1200 });
  });

  it("keeps the last count while a resumed run is still reading, instead of dropping to nothing", () => {
    const before: CopyProgress = { remaining: 300, secondsRemaining: 60, total: 1200 };

    expect(advanceCopyProgress(before, signal())).toBe(before);
  });

  it("measures a resumed run against the whole copy, not just what was left", () => {
    const before: CopyProgress = { remaining: 300, secondsRemaining: 60, total: 1200 };

    const resumed = advanceCopyProgress(before, signal({
      syncEventsRemaining: 250,
      syncEventsTotal: 300,
      syncSecondsRemaining: 50,
    }));

    expect(resumed).toEqual({ remaining: 250, secondsRemaining: 50, total: 1200 });
    expect(resolveCopyPercent(resumed)).toBeCloseTo((950 / 1200) * 100);
  });

  it("returns the same progress when nothing changed, so a render can compare it", () => {
    const before: CopyProgress = { remaining: 300, secondsRemaining: 60, total: 1200 };

    expect(advanceCopyProgress(before, signal({
      syncEventsRemaining: 300,
      syncEventsTotal: 1200,
      syncSecondsRemaining: 60,
    }))).toBe(before);
  });
});

describe("copy progress copy", () => {
  it("counts the events still to copy", () => {
    expect(describeRemainingEvents({ remaining: 1100, secondsRemaining: null, total: 1200 })).toBe("1,100 more events");
    expect(describeRemainingEvents({ remaining: 1, secondsRemaining: null, total: 1200 })).toBe("1 more event");
  });

  it("says copying until there is a count", () => {
    expect(describeRemainingEvents(null)).toBe("Copying");
    expect(describeRemainingEvents({ remaining: 0, secondsRemaining: null, total: 1200 })).toBe("Copying");
  });

  it("rounds the estimate to minutes and never promises one it does not have", () => {
    expect(describeTimeLeft(null)).toBeNull();
    expect(describeTimeLeft(40)).toBe("Less than a minute left.");
    expect(describeTimeLeft(70)).toBe("About 1 minute left.");
    expect(describeTimeLeft(250)).toBe("About 4 minutes left.");
  });
});
