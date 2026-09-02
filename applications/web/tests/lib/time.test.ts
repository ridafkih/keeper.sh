import { describe, expect, it } from "vitest";
import { formatClock, formatTimeRange } from "../../src/lib/time";

const at = (hour: number, minute = 0): Date => new Date(2026, 0, 5, hour, minute);

describe("formatClock", () => {
  it("drops the period and pads minutes", () => {
    expect(formatClock(at(10, 42))).toBe("10:42");
    expect(formatClock(at(0, 5))).toBe("12:05");
    expect(formatClock(at(13))).toBe("1:00");
  });
});

describe("formatTimeRange", () => {
  it("drops the start's period when both ends share it", () => {
    expect(formatTimeRange(at(9), at(10))).toBe("9:00 – 10:00 AM");
  });

  it("keeps both periods when the range crosses noon", () => {
    expect(formatTimeRange(at(11, 30), at(13))).toBe("11:30 AM – 1:00 PM");
  });

  it("labels noon as 12 PM", () => {
    expect(formatTimeRange(at(12), at(12, 30))).toBe("12:00 – 12:30 PM");
  });

  it("keeps both periods when the range ends at midnight", () => {
    expect(formatTimeRange(at(22), new Date(2026, 0, 6, 0, 0))).toBe("10:00 PM – 12:00 AM");
  });
});
