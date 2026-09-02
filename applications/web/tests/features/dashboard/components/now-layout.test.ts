import { describe, expect, it } from "vitest";
import { resolveNowLayout } from "../../../../src/features/dashboard/components/now-layout";
import { at } from "../../../helpers/clock";

const days = [new Date(2026, 0, 4), new Date(2026, 0, 5), new Date(2026, 0, 6)];

describe("resolveNowLayout", () => {
  it("labels the clock, places the line by wall-clock fraction, and boxes today's column", () => {
    const layout = resolveNowLayout(days, at(10, 42));

    expect(layout.label).toBe("10:42");
    expect(layout.topFraction).toBeCloseTo((10 * 60 + 42) / 1440);
    expect(layout.today).toEqual({ left: 1 / 3, width: 1 / 3 });
  });

  it("drops today's box when today is outside the strip", () => {
    expect(resolveNowLayout(days, new Date(2026, 0, 9, 10)).today).toBeNull();
  });

  it("covers the nearest hour label only within the pill's clearance", () => {
    expect(resolveNowLayout(days, at(10)).coveredHour).toBe(10);
    expect(resolveNowLayout(days, at(10, 14)).coveredHour).toBe(10);
    expect(resolveNowLayout(days, at(9, 46)).coveredHour).toBe(10);
    expect(resolveNowLayout(days, at(10, 15)).coveredHour).toBeNull();
    expect(resolveNowLayout(days, at(10, 30)).coveredHour).toBeNull();
  });
});
