import { describe, expect, it } from "vitest";
import {
  isEmptyTimeRange,
  isInvertedTimeRange,
  resolvePointInTimeRange,
  resolveWholeDayTimeRange,
} from "../../../src/core/events/time-range";

describe("resolveWholeDayTimeRange", () => {
  it("reads a same-date range as the single day it starts on", () => {
    expect(resolveWholeDayTimeRange({
      endTime: new Date("2026-03-08T00:00:00.000Z"),
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    })).toEqual({
      endTime: new Date("2026-03-09T00:00:00.000Z"),
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    });
  });

  it("widens a range shorter than a day to a full day", () => {
    expect(resolveWholeDayTimeRange({
      endTime: new Date("2026-03-08T11:00:00.000Z"),
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    })).toEqual({
      endTime: new Date("2026-03-09T00:00:00.000Z"),
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    });
  });

  it("widens a range that ends before it starts to a full day", () => {
    expect(resolveWholeDayTimeRange({
      endTime: new Date("2026-03-07T00:00:00.000Z"),
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    })).toEqual({
      endTime: new Date("2026-03-09T00:00:00.000Z"),
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    });
  });

  it("leaves a multi-day range untouched", () => {
    expect(resolveWholeDayTimeRange({
      endTime: new Date("2026-03-11T00:00:00.000Z"),
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    })).toEqual({
      endTime: new Date("2026-03-11T00:00:00.000Z"),
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    });
  });
});

describe("resolvePointInTimeRange", () => {
  it("gives a range that ends when it starts the shortest renderable span", () => {
    expect(resolvePointInTimeRange({
      endTime: new Date("2026-03-08T09:00:00.000Z"),
      startTime: new Date("2026-03-08T09:00:00.000Z"),
    })).toEqual({
      endTime: new Date("2026-03-08T09:01:00.000Z"),
      startTime: new Date("2026-03-08T09:00:00.000Z"),
    });
  });

  it("anchors a range that ends before it starts on the start the source states", () => {
    expect(resolvePointInTimeRange({
      endTime: new Date("2026-03-08T08:00:00.000Z"),
      startTime: new Date("2026-03-08T09:00:00.000Z"),
    })).toEqual({
      endTime: new Date("2026-03-08T09:01:00.000Z"),
      startTime: new Date("2026-03-08T09:00:00.000Z"),
    });
  });

  it("leaves a range that ends after it starts alone", () => {
    expect(resolvePointInTimeRange({
      endTime: new Date("2026-03-08T09:00:00.001Z"),
      startTime: new Date("2026-03-08T09:00:00.000Z"),
    })).toEqual({
      endTime: new Date("2026-03-08T09:00:00.001Z"),
      startTime: new Date("2026-03-08T09:00:00.000Z"),
    });
  });
});

describe("isEmptyTimeRange", () => {
  it("reports a range that ends when it starts", () => {
    expect(isEmptyTimeRange({
      endTime: new Date("2026-03-08T09:00:00.000Z"),
      startTime: new Date("2026-03-08T09:00:00.000Z"),
    })).toBe(true);
  });

  it("does not report a range that ends after it starts", () => {
    expect(isEmptyTimeRange({
      endTime: new Date("2026-03-08T09:30:00.000Z"),
      startTime: new Date("2026-03-08T09:00:00.000Z"),
    })).toBe(false);
  });

  it("does not report a range that ends before it starts", () => {
    expect(isEmptyTimeRange({
      endTime: new Date("2026-03-08T08:00:00.000Z"),
      startTime: new Date("2026-03-08T09:00:00.000Z"),
    })).toBe(false);
  });
});

describe("isInvertedTimeRange", () => {
  it("reports a range that ends before it starts", () => {
    expect(isInvertedTimeRange({
      endTime: new Date("2026-03-08T08:00:00.000Z"),
      startTime: new Date("2026-03-08T09:00:00.000Z"),
    })).toBe(true);
  });

  it("does not report a range that ends when it starts", () => {
    expect(isInvertedTimeRange({
      endTime: new Date("2026-03-08T09:00:00.000Z"),
      startTime: new Date("2026-03-08T09:00:00.000Z"),
    })).toBe(false);
  });
});
