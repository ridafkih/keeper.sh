import { describe, expect, it } from "vitest";
import { toBusyInterval } from "../../src/queries/find-free-time";
import { mergeIntervals } from "../../src/utils/free-time";

const RANGE = {
  end: new Date("2027-04-08T00:00:00.000Z"),
  start: new Date("2027-03-08T00:00:00.000Z"),
};

const toMs = ({ end, start }: { end: Date; start: Date }) => ({
  end: end.getTime(),
  start: start.getTime(),
});

describe("the busy intervals behind find_free_time", () => {
  it("keeps an ordinary range exactly as stated", () => {
    const interval = toBusyInterval({
      availability: "busy",
      endTime: new Date("2027-03-20T17:00:00.000Z"),
      isAllDay: false,
      startTime: new Date("2027-03-20T16:00:00.000Z"),
    }, RANGE);

    expect(interval.start.toISOString()).toBe("2027-03-20T16:00:00.000Z");
    expect(interval.end.toISOString()).toBe("2027-03-20T17:00:00.000Z");
  });

  it("blocks the day a same-date all-day event names", () => {
    const interval = toBusyInterval({
      availability: "busy",
      endTime: new Date("2027-03-22T00:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2027-03-22T00:00:00.000Z"),
    }, RANGE);

    expect(mergeIntervals([toMs(interval)])).toHaveLength(1);
    expect(interval.start.toISOString()).toBe("2027-03-22T00:00:00.000Z");
    expect(interval.end.toISOString()).toBe("2027-03-23T00:00:00.000Z");
  });

  it("blocks the instant a zero-duration timed event names", () => {
    const interval = toBusyInterval({
      availability: "busy",
      endTime: new Date("2027-03-21T16:00:00.000Z"),
      isAllDay: false,
      startTime: new Date("2027-03-21T16:00:00.000Z"),
    }, RANGE);

    expect(mergeIntervals([toMs(interval)])).toHaveLength(1);
    expect(interval.start.toISOString()).toBe("2027-03-21T16:00:00.000Z");
    expect(interval.end.toISOString()).toBe("2027-03-21T16:01:00.000Z");
  });

  it("blocks the instant an inverted range names rather than discarding it", () => {
    const interval = toBusyInterval({
      availability: "busy",
      endTime: new Date("2027-03-05T16:00:00.000Z"),
      isAllDay: false,
      startTime: new Date("2027-03-23T16:00:00.000Z"),
    }, RANGE);

    expect(mergeIntervals([toMs(interval)])).toHaveLength(1);
    expect(interval.start.toISOString()).toBe("2027-03-23T16:00:00.000Z");
    expect(interval.end.toISOString()).toBe("2027-03-23T16:01:00.000Z");
  });

  it("still clamps a widened range to the requested window", () => {
    const interval = toBusyInterval({
      availability: "busy",
      endTime: new Date("2027-04-07T23:59:30.000Z"),
      isAllDay: false,
      startTime: new Date("2027-04-07T23:59:30.000Z"),
    }, RANGE);

    expect(interval.end.toISOString()).toBe("2027-04-08T00:00:00.000Z");
  });
});
