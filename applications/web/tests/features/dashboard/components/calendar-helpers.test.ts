import { describe, expect, it } from "vitest";
import {
  addDays,
  getWeekFetchRange,
  startOfVisibleWeek,
  WEEK_STARTS_ON,
  WEEK_VIEW_DAYS,
} from "../../../../src/features/dashboard/components/calendar-helpers";

const MS_PER_DAY = 86_400_000;

const visibleDays = (anchor: Date): Date[] =>
  Array.from({ length: WEEK_VIEW_DAYS }, (_, index) => addDays(startOfVisibleWeek(anchor), index));

const contains = (range: { start: Date; end: Date }, day: Date): boolean =>
  day.getTime() >= range.start.getTime() && day.getTime() < range.end.getTime();

describe("getWeekFetchRange", () => {
  it("starts at midnight on the first weekday and spans four weeks", () => {
    const { start, end } = getWeekFetchRange(new Date(2026, 7, 22, 15, 30));

    expect(start.getDay()).toBe(WEEK_STARTS_ON);
    expect([start.getHours(), start.getMinutes()]).toEqual([0, 0]);
    expect(Math.round((end.getTime() - start.getTime()) / MS_PER_DAY)).toBe(28);
  });

  it("covers the visible week, and the weeks a step or a page away, on every day", () => {
    // Two years of anchors cover daylight-saving changes and a year boundary.
    const last = new Date(2027, 11, 31);
    const uncovered: string[] = [];
    for (let anchor = new Date(2026, 0, 1); anchor <= last; anchor = addDays(anchor, 1)) {
      const range = getWeekFetchRange(anchor);
      for (const offset of [0, 1, -1, WEEK_VIEW_DAYS, -WEEK_VIEW_DAYS]) {
        for (const day of visibleDays(addDays(anchor, offset))) {
          if (!contains(range, day)) uncovered.push(`${anchor.toDateString()} ${offset}`);
        }
      }
    }

    expect(uncovered).toEqual([]);
  });
});
