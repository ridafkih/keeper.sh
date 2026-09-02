import { describe, expect, it } from "vitest";
import { resolveNowLayout } from "../../../../src/features/dashboard/components/now-layout";

const at = (hour: number, minute = 0): Date => new Date(2026, 0, 5, hour, minute);

const days = [new Date(2026, 0, 4), new Date(2026, 0, 5), new Date(2026, 0, 6)];

describe("resolveNowLayout", () => {
  it("places the line by wall-clock fraction and finds today's column", () => {
    const layout = resolveNowLayout(days, at(10, 42));

    expect(layout.topFraction).toBeCloseTo((10 * 60 + 42) / 1440);
    expect(layout.todayIndex).toBe(1);
  });

  it("reports -1 when today is outside the strip", () => {
    expect(resolveNowLayout(days, new Date(2026, 0, 9, 10)).todayIndex).toBe(-1);
  });

  it("covers the nearest hour label only within the pill's clearance", () => {
    expect(resolveNowLayout(days, at(10)).coveredHour).toBe(10);
    expect(resolveNowLayout(days, at(10, 14)).coveredHour).toBe(10);
    expect(resolveNowLayout(days, at(9, 46)).coveredHour).toBe(10);
    expect(resolveNowLayout(days, at(10, 15)).coveredHour).toBeNull();
    expect(resolveNowLayout(days, at(10, 30)).coveredHour).toBeNull();
  });
});
