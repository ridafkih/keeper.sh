import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  getMonthFetchRange,
  getMonthViewFocusDay,
  getWeekFetchRange,
  isSameMonth,
  MONTH_VIEW_ROWS,
  startOfMonth,
  startOfMonthGrid,
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

// Two years of months cover daylight-saving changes and a year boundary.
const MONTHS = Array.from({ length: 24 }, (_, index) => new Date(2026, index, 1));

const MONTH_VIEW_DAYS = MONTH_VIEW_ROWS * 7;

describe("getMonthFetchRange", () => {
  it("starts and ends at midnight on the first weekday", () => {
    const { start, end } = getMonthFetchRange(new Date(2026, 7, 22, 15, 30));

    for (const edge of [start, end]) {
      expect(edge.getDay()).toBe(WEEK_STARTS_ON);
      expect([edge.getHours(), edge.getMinutes()]).toEqual([0, 0]);
    }
  });

  it("covers the classic layouts of the month and its neighbours", () => {
    const uncovered: string[] = [];
    for (const month of MONTHS) {
      const range = getMonthFetchRange(month);
      for (const offset of [-1, 0, 1]) {
        const gridStart = startOfMonthGrid(addMonths(month, offset));
        for (const index of [0, MONTH_VIEW_DAYS - 1]) {
          if (!contains(range, addDays(gridStart, index))) {
            uncovered.push(`${month.toDateString()} ${offset}`);
          }
        }
      }
    }

    expect(uncovered).toEqual([]);
  });

  it("holds still for every anchor within a month", () => {
    const moved: string[] = [];
    for (const month of MONTHS) {
      const expected = getMonthFetchRange(month);
      const next = addMonths(month, 1);
      for (let anchor = month; anchor < next; anchor = addDays(anchor, 1)) {
        const range = getMonthFetchRange(anchor);
        if (
          range.start.getTime() !== expected.start.getTime() ||
          range.end.getTime() !== expected.end.getTime()
        ) {
          moved.push(anchor.toDateString());
        }
      }
    }

    expect(moved).toEqual([]);
  });
});

describe("getMonthViewFocusDay", () => {
  it("stays in the month within a row of its classic layout, and leaves it three rows away", () => {
    const wrong: string[] = [];
    for (const month of MONTHS) {
      const gridStart = startOfMonthGrid(month);
      for (const rows of [-1, 0, 1]) {
        const focusDay = getMonthViewFocusDay(addDays(gridStart, rows * 7));
        if (!isSameMonth(focusDay, month)) wrong.push(`${month.toDateString()} ${rows}`);
      }
      for (const rows of [-3, 3]) {
        const focusDay = getMonthViewFocusDay(addDays(gridStart, rows * 7));
        if (isSameMonth(focusDay, month)) wrong.push(`${month.toDateString()} ${rows}`);
      }
    }

    expect(wrong).toEqual([]);
  });
});

describe("startOfMonth", () => {
  it("lets a month step from the 31st land on the next month", () => {
    const next = addMonths(startOfMonth(new Date(2026, 0, 31)), 1);

    expect([next.getFullYear(), next.getMonth()]).toEqual([2026, 1]);
  });
});
