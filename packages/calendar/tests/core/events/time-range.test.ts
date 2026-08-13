import { describe, expect, it } from "vitest";
import { resolveMirrorableTimeRange } from "../../../src/core/events/time-range";

describe("resolveMirrorableTimeRange", () => {
  it("keeps a timed range that ends after it starts", () => {
    expect(resolveMirrorableTimeRange({
      endTime: new Date("2026-03-08T10:00:00.000Z"),
      startTime: new Date("2026-03-08T09:00:00.000Z"),
    })).toEqual({
      endTime: new Date("2026-03-08T10:00:00.000Z"),
      startTime: new Date("2026-03-08T09:00:00.000Z"),
    });
  });

  it("rejects a timed range that ends when it starts", () => {
    expect(resolveMirrorableTimeRange({
      endTime: new Date("2026-03-08T09:00:00.000Z"),
      startTime: new Date("2026-03-08T09:00:00.000Z"),
    })).toBeNull();
  });

  it("rejects a timed range that ends before it starts", () => {
    expect(resolveMirrorableTimeRange({
      endTime: new Date("2026-03-08T08:00:00.000Z"),
      startTime: new Date("2026-03-08T09:00:00.000Z"),
    })).toBeNull();
  });

  it("reads a same-date all-day range as the single day it starts on", () => {
    expect(resolveMirrorableTimeRange({
      endTime: new Date("2026-03-08T00:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    })).toEqual({
      endTime: new Date("2026-03-09T00:00:00.000Z"),
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    });
  });

  it("widens an all-day range shorter than a day to a full day", () => {
    expect(resolveMirrorableTimeRange({
      endTime: new Date("2026-03-08T11:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    })).toEqual({
      endTime: new Date("2026-03-09T00:00:00.000Z"),
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    });
  });

  it("leaves a multi-day all-day range untouched", () => {
    expect(resolveMirrorableTimeRange({
      endTime: new Date("2026-03-11T00:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    })).toEqual({
      endTime: new Date("2026-03-11T00:00:00.000Z"),
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    });
  });

  it("treats an inferred all-day range like a declared one", () => {
    expect(resolveMirrorableTimeRange({
      endTime: new Date("2026-03-09T00:00:00.000Z"),
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    })).toEqual({
      endTime: new Date("2026-03-09T00:00:00.000Z"),
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    });
  });
});
