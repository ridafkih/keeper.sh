import { describe, expect, it } from "vitest";
import {
  resolveRepresentableTimeRange,
  resolveWholeDayTimeRange,
} from "../../../src/core/events/time-range";
import type { AllDayEventShape } from "../../../src/core/events/all-day";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const toIsoPair = ({ endTime, startTime }: { endTime: Date; startTime: Date }) =>
  ({ end: endTime.toISOString(), start: startTime.toISOString() });

const shapeTwice = (range: AllDayEventShape) => {
  const once = resolveRepresentableTimeRange(range);
  const twice = resolveRepresentableTimeRange({
    ...once,
    ...(typeof range.isAllDay === "boolean" && { isAllDay: range.isAllDay }),
  });
  return { once, twice };
};

const RANGES: { isAllDay: boolean; label: string; end: string; start: string }[] = [
  { end: "2027-03-08T00:00:00.000Z", isAllDay: true, label: "a same-date all-day range", start: "2027-03-08T00:00:00.000Z" },
  { end: "2027-03-08T17:00:00.000Z", isAllDay: true, label: "an all-day range inside one day", start: "2027-03-08T09:00:00.000Z" },
  { end: "2027-03-10T05:00:00.000Z", isAllDay: true, label: "an all-day range ending mid-day", start: "2027-03-08T05:00:00.000Z" },
  { end: "2027-03-05T00:00:00.000Z", isAllDay: true, label: "an inverted all-day range", start: "2027-03-08T00:00:00.000Z" },
  { end: "2027-03-08T00:00:00.001Z", isAllDay: true, label: "an all-day range one millisecond long", start: "2027-03-08T00:00:00.000Z" },
  { end: "2027-03-09T00:00:00.000Z", isAllDay: false, label: "a timed range spanning a whole day", start: "2027-03-08T00:00:00.000Z" },
  { end: "2027-03-08T09:00:00.000Z", isAllDay: false, label: "a zero-duration timed range", start: "2027-03-08T09:00:00.000Z" },
  { end: "2027-03-08T08:00:00.000Z", isAllDay: false, label: "an inverted timed range", start: "2027-03-08T09:00:00.000Z" },
];

describe("shaping a range a second time", () => {
  for (const range of RANGES) {
    it(`leaves ${range.label} where the first shaping put it`, () => {
      const { once, twice } = shapeTwice({
        endTime: new Date(range.end),
        isAllDay: range.isAllDay,
        startTime: new Date(range.start),
      });

      expect(toIsoPair(twice)).toEqual(toIsoPair(once));
    });
  }

  it("leaves every offset within a day where the first shaping put it", () => {
    const dayStart = Date.UTC(2027, 2, 8);
    const drifted: string[] = [];

    for (let offset = 0; offset < MS_PER_DAY; offset += 60_000) {
      const { once, twice } = shapeTwice({
        endTime: new Date(dayStart + offset + 3 * 60 * 60 * 1000),
        isAllDay: true,
        startTime: new Date(dayStart + offset),
      });
      if (twice.startTime.getTime() !== once.startTime.getTime()
        || twice.endTime.getTime() !== once.endTime.getTime()) {
        drifted.push(new Date(dayStart + offset).toISOString());
      }
    }

    expect(drifted).toEqual([]);
  });
});

describe("snapping an all-day range onto the days it touches", () => {
  it("covers every day a ragged multi-day range reaches", () => {
    expect(toIsoPair(resolveWholeDayTimeRange({
      endTime: new Date("2027-03-12T17:00:00.000Z"),
      startTime: new Date("2027-03-08T09:00:00.000Z"),
    }))).toEqual({ end: "2027-03-13T00:00:00.000Z", start: "2027-03-08T00:00:00.000Z" });
  });

  it("snaps a range that predates the epoch onto the same day grid", () => {
    expect(toIsoPair(resolveWholeDayTimeRange({
      endTime: new Date("1969-12-31T17:00:00.000Z"),
      startTime: new Date("1969-12-31T09:00:00.000Z"),
    }))).toEqual({ end: "1970-01-01T00:00:00.000Z", start: "1969-12-31T00:00:00.000Z" });
  });

  it("keeps a range that already sits on the grid exactly where it is", () => {
    expect(toIsoPair(resolveWholeDayTimeRange({
      endTime: new Date("2027-03-11T00:00:00.000Z"),
      startTime: new Date("2027-03-08T00:00:00.000Z"),
    }))).toEqual({ end: "2027-03-11T00:00:00.000Z", start: "2027-03-08T00:00:00.000Z" });
  });

  it("always answers with a whole number of days", () => {
    const ragged: string[] = [];

    for (let offset = 0; offset < MS_PER_DAY; offset += 37 * 60_000) {
      for (const span of [0, 1, 60_000, MS_PER_DAY - 1, MS_PER_DAY, MS_PER_DAY + 1, -MS_PER_DAY]) {
        const startTime = new Date(Date.UTC(2027, 2, 8) + offset);
        const { endTime, startTime: snappedStart } = resolveWholeDayTimeRange({
          endTime: new Date(startTime.getTime() + span),
          startTime,
        });
        const width = endTime.getTime() - snappedStart.getTime();
        if (
          snappedStart.getTime() % MS_PER_DAY !== 0
          || width % MS_PER_DAY !== 0
          || width <= 0
        ) {
          ragged.push(`${startTime.toISOString()} +${span}ms`);
        }
      }
    }

    expect(ragged).toEqual([]);
  });
});
