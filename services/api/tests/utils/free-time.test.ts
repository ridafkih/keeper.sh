import { describe, expect, it } from "vitest";
import {
  DEFAULT_FREE_SLOTS,
  findFreeSlots,
  FreeTimeValidationError,
  MAX_FREE_SLOTS,
  mergeIntervals,
  parseWorkingHours,
  subtractBusyFromWindow,
} from "../../src/utils/free-time";
import type { FreeTimeOptions, TimeInterval } from "../../src/utils/free-time";

const interval = (start: string, end: string): TimeInterval => ({
  end: new Date(end),
  start: new Date(start),
});

const msInterval = (start: string, end: string) => ({
  end: new Date(end).getTime(),
  start: new Date(start).getTime(),
});

const baseOptions = (overrides?: Partial<FreeTimeOptions>): FreeTimeOptions => ({
  durationMinutes: 30,
  limit: DEFAULT_FREE_SLOTS,
  timezone: "UTC",
  workingHours: null,
  ...overrides,
});

describe("mergeIntervals", () => {
  it("merges overlapping intervals", () => {
    expect(mergeIntervals([
      msInterval("2026-03-02T09:00:00Z", "2026-03-02T10:00:00Z"),
      msInterval("2026-03-02T09:30:00Z", "2026-03-02T11:00:00Z"),
    ])).toEqual([msInterval("2026-03-02T09:00:00Z", "2026-03-02T11:00:00Z")]);
  });

  it("merges intervals that touch exactly", () => {
    expect(mergeIntervals([
      msInterval("2026-03-02T09:00:00Z", "2026-03-02T10:00:00Z"),
      msInterval("2026-03-02T10:00:00Z", "2026-03-02T11:00:00Z"),
    ])).toEqual([msInterval("2026-03-02T09:00:00Z", "2026-03-02T11:00:00Z")]);
  });

  it("keeps disjoint intervals separate and sorted", () => {
    expect(mergeIntervals([
      msInterval("2026-03-02T14:00:00Z", "2026-03-02T15:00:00Z"),
      msInterval("2026-03-02T09:00:00Z", "2026-03-02T10:00:00Z"),
    ])).toEqual([
      msInterval("2026-03-02T09:00:00Z", "2026-03-02T10:00:00Z"),
      msInterval("2026-03-02T14:00:00Z", "2026-03-02T15:00:00Z"),
    ]);
  });

  it("swallows intervals fully contained in an earlier one", () => {
    expect(mergeIntervals([
      msInterval("2026-03-02T09:00:00Z", "2026-03-02T17:00:00Z"),
      msInterval("2026-03-02T11:00:00Z", "2026-03-02T12:00:00Z"),
    ])).toEqual([msInterval("2026-03-02T09:00:00Z", "2026-03-02T17:00:00Z")]);
  });

  it("drops zero-length and inverted intervals", () => {
    expect(mergeIntervals([
      msInterval("2026-03-02T09:00:00Z", "2026-03-02T09:00:00Z"),
      msInterval("2026-03-02T12:00:00Z", "2026-03-02T11:00:00Z"),
    ])).toEqual([]);
  });
});

describe("subtractBusyFromWindow", () => {
  it("returns the whole window when nothing is busy", () => {
    const window = msInterval("2026-03-02T09:00:00Z", "2026-03-02T17:00:00Z");

    expect(subtractBusyFromWindow(window, [])).toEqual([window]);
  });

  it("splits the window around a busy block", () => {
    expect(subtractBusyFromWindow(
      msInterval("2026-03-02T09:00:00Z", "2026-03-02T17:00:00Z"),
      [msInterval("2026-03-02T12:00:00Z", "2026-03-02T13:00:00Z")],
    )).toEqual([
      msInterval("2026-03-02T09:00:00Z", "2026-03-02T12:00:00Z"),
      msInterval("2026-03-02T13:00:00Z", "2026-03-02T17:00:00Z"),
    ]);
  });

  it("ignores busy blocks entirely outside the window", () => {
    const window = msInterval("2026-03-02T09:00:00Z", "2026-03-02T17:00:00Z");

    expect(subtractBusyFromWindow(window, [
      msInterval("2026-03-02T06:00:00Z", "2026-03-02T07:00:00Z"),
      msInterval("2026-03-02T20:00:00Z", "2026-03-02T21:00:00Z"),
    ])).toEqual([window]);
  });

  it("clips busy blocks that straddle the window edges", () => {
    expect(subtractBusyFromWindow(
      msInterval("2026-03-02T09:00:00Z", "2026-03-02T17:00:00Z"),
      [
        msInterval("2026-03-02T08:00:00Z", "2026-03-02T10:00:00Z"),
        msInterval("2026-03-02T16:00:00Z", "2026-03-02T19:00:00Z"),
      ],
    )).toEqual([msInterval("2026-03-02T10:00:00Z", "2026-03-02T16:00:00Z")]);
  });

  it("returns nothing when the window is fully busy", () => {
    expect(subtractBusyFromWindow(
      msInterval("2026-03-02T09:00:00Z", "2026-03-02T17:00:00Z"),
      [msInterval("2026-03-02T08:00:00Z", "2026-03-02T18:00:00Z")],
    )).toEqual([]);
  });
});

describe("parseWorkingHours", () => {
  it("returns null when no working hours are supplied", () => {
    expect(parseWorkingHours(null, null, null)).toBeNull();
  });

  it("parses a wall-clock window into local minutes", () => {
    expect(parseWorkingHours("09:00", "17:30", null)).toEqual({
      days: null,
      endMinute: 1050,
      startMinute: 540,
    });
  });

  it("parses working days", () => {
    expect(parseWorkingHours("09:00", "17:00", "1,2,3,4,5")?.days).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects a half-specified window", () => {
    expect(() => parseWorkingHours("09:00", null, null)).toThrow(FreeTimeValidationError);
  });

  it("rejects working days without working hours", () => {
    expect(() => parseWorkingHours(null, null, "1,2")).toThrow(FreeTimeValidationError);
  });

  it("rejects a malformed wall-clock time", () => {
    expect(() => parseWorkingHours("9am", "17:00", null)).toThrow(FreeTimeValidationError);
  });

  it("rejects an end that is not after the start", () => {
    expect(() => parseWorkingHours("17:00", "09:00", null)).toThrow(FreeTimeValidationError);
  });

  it("rejects out-of-range weekdays", () => {
    expect(() => parseWorkingHours("09:00", "17:00", "7")).toThrow(FreeTimeValidationError);
  });
});

describe("findFreeSlots", () => {
  it("returns the whole range when there are no busy events", () => {
    expect(findFreeSlots(
      interval("2026-03-02T09:00:00Z", "2026-03-02T17:00:00Z"),
      [],
      baseOptions(),
    )).toEqual([
      {
        durationMinutes: 480,
        end: "2026-03-02T17:00:00.000Z",
        start: "2026-03-02T09:00:00.000Z",
      },
    ]);
  });

  it("drops gaps shorter than the requested duration", () => {
    const slots = findFreeSlots(
      interval("2026-03-02T09:00:00Z", "2026-03-02T17:00:00Z"),
      [
        interval("2026-03-02T09:00:00Z", "2026-03-02T12:00:00Z"),
        interval("2026-03-02T12:15:00Z", "2026-03-02T17:00:00Z"),
      ],
      baseOptions({ durationMinutes: 30 }),
    );

    expect(slots).toEqual([]);
  });

  it("keeps a gap exactly as long as the requested duration", () => {
    const slots = findFreeSlots(
      interval("2026-03-02T09:00:00Z", "2026-03-02T17:00:00Z"),
      [
        interval("2026-03-02T09:00:00Z", "2026-03-02T12:00:00Z"),
        interval("2026-03-02T12:30:00Z", "2026-03-02T17:00:00Z"),
      ],
      baseOptions({ durationMinutes: 30 }),
    );

    expect(slots).toEqual([
      {
        durationMinutes: 30,
        end: "2026-03-02T12:30:00.000Z",
        start: "2026-03-02T12:00:00.000Z",
      },
    ]);
  });

  it("restricts candidates to working hours in the requested timezone", () => {
    const slots = findFreeSlots(
      interval("2026-03-02T00:00:00Z", "2026-03-03T00:00:00Z"),
      [],
      baseOptions({
        durationMinutes: 60,
        timezone: "America/New_York",
        workingHours: { days: null, endMinute: 1020, startMinute: 540 },
      }),
    );

    expect(slots).toEqual([
      {
        durationMinutes: 480,
        end: "2026-03-02T22:00:00.000Z",
        start: "2026-03-02T14:00:00.000Z",
      },
    ]);
  });

  it("skips local days excluded by workingDays", () => {
    const slots = findFreeSlots(
      interval("2026-03-07T00:00:00Z", "2026-03-10T00:00:00Z"),
      [],
      baseOptions({
        durationMinutes: 60,
        timezone: "UTC",
        workingHours: { days: [1], endMinute: 1020, startMinute: 540 },
      }),
    );

    expect(slots).toEqual([
      {
        durationMinutes: 480,
        end: "2026-03-09T17:00:00.000Z",
        start: "2026-03-09T09:00:00.000Z",
      },
    ]);
  });

  it("tracks the local wall clock across a daylight saving transition", () => {
    const slots = findFreeSlots(
      interval("2026-03-07T00:00:00Z", "2026-03-10T00:00:00Z"),
      [],
      baseOptions({
        durationMinutes: 60,
        timezone: "America/New_York",
        workingHours: { days: null, endMinute: 1020, startMinute: 540 },
      }),
    );

    expect(slots.map(({ start }) => start)).toEqual([
      "2026-03-07T14:00:00.000Z",
      "2026-03-08T13:00:00.000Z",
      "2026-03-09T13:00:00.000Z",
    ]);
  });

  it("clamps working-hour windows to the requested range", () => {
    const slots = findFreeSlots(
      interval("2026-03-02T12:00:00Z", "2026-03-02T15:00:00Z"),
      [],
      baseOptions({
        durationMinutes: 30,
        timezone: "UTC",
        workingHours: { days: null, endMinute: 1020, startMinute: 540 },
      }),
    );

    expect(slots).toEqual([
      {
        durationMinutes: 180,
        end: "2026-03-02T15:00:00.000Z",
        start: "2026-03-02T12:00:00.000Z",
      },
    ]);
  });

  it("caps the number of returned slots at the limit", () => {
    const slots = findFreeSlots(
      interval("2026-03-02T00:00:00Z", "2026-03-09T00:00:00Z"),
      [],
      baseOptions({
        durationMinutes: 60,
        limit: 2,
        workingHours: { days: null, endMinute: 1020, startMinute: 540 },
      }),
    );

    expect(slots).toHaveLength(2);
  });

  it("rejects a non-positive duration", () => {
    expect(() => findFreeSlots(
      interval("2026-03-02T09:00:00Z", "2026-03-02T17:00:00Z"),
      [],
      baseOptions({ durationMinutes: 0 }),
    )).toThrow(FreeTimeValidationError);
  });

  it("rejects a limit above the maximum", () => {
    expect(() => findFreeSlots(
      interval("2026-03-02T09:00:00Z", "2026-03-02T17:00:00Z"),
      [],
      baseOptions({ limit: MAX_FREE_SLOTS + 1 }),
    )).toThrow(FreeTimeValidationError);
  });

  it("rejects a timezone that is not an IANA identifier", () => {
    expect(() => findFreeSlots(
      interval("2026-03-02T09:00:00Z", "2026-03-02T17:00:00Z"),
      [],
      baseOptions({ timezone: "Mars/Olympus_Mons" }),
    )).toThrow(RangeError);
  });
});
