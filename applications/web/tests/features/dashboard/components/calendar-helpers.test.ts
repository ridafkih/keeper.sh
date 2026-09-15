import { describe, expect, it } from "vitest";
import {
  addDays,
  getMonthFetchRange,
  getMonthGridDays,
  getWeekFetchRange,
  resolveColumnLayout,
  resolveTweeningColumnLayout,
  sameColumnLayout,
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

describe("getMonthFetchRange", () => {
  it("spans exactly the month grid's 42 days", () => {
    const anchor = new Date(2026, 7, 22);
    const days = getMonthGridDays(anchor);
    const { start, end } = getMonthFetchRange(anchor);

    expect(start.getTime()).toBe(days[0].getTime());
    expect(end.getTime()).toBe(addDays(days[41], 1).getTime());
    expect(Math.round((end.getTime() - start.getTime()) / MS_PER_DAY)).toBe(42);
  });
});

describe("resolveColumnLayout", () => {
  it("gives every column a whole number of pixels and lets the gutter absorb the remainder", () => {
    expect(resolveColumnLayout(1006, 52)).toEqual({ column: 136, gutter: 54 });
    expect(resolveColumnLayout(1008, 52)).toEqual({ column: 137, gutter: 49 });
    expect(resolveColumnLayout(1011, 52)).toEqual({ column: 137, gutter: 52 });
    expect(resolveColumnLayout(40, 52)).toEqual({ column: 1, gutter: 33 });
  });

  it("keeps fractional columns and the nominal gutter while the frame is tweening", () => {
    expect(resolveTweeningColumnLayout(1006, 52)).toEqual({ column: 954 / 7, gutter: 52 });
    expect(resolveTweeningColumnLayout(40, 52)).toEqual({ column: 1, gutter: 52 });
    expect(sameColumnLayout({ column: 136, gutter: 54 }, { column: 136, gutter: 54 })).toBe(true);
    expect(sameColumnLayout({ column: 136, gutter: 54 }, { column: 136, gutter: 53 })).toBe(false);
  });
});
