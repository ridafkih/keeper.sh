/**
 * Native-`Date` helpers for the month calendar grid. Keeper does not depend on
 * `date-fns`, so the grid math is done with the standard `Date`/`Intl` APIs,
 * matching the day-offset approach already used in `event-graph.tsx`.
 */

/** First column of the week. 0 = Sunday, 1 = Monday. */
export const WEEK_STARTS_ON = 0;

/** Cells in a fixed 6×7 month grid. */
const GRID_CELLS = 42;

/** Midnight on the first day of `date`'s month. */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** `date` shifted by `months`, clamped to the same day-of-month semantics as
 * the `Date` constructor (day 1 keeps callers on solid ground). */
export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

/** `date` shifted by `days`, at midnight. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Midnight on the first `WEEK_STARTS_ON` weekday on or before `date`. */
export function startOfWeek(date: Date): Date {
  const offset = (date.getDay() - WEEK_STARTS_ON + 7) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
}

/** Whether two dates fall in the same calendar month and year. */
export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** Whether two dates fall on the same calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** The 42 days of the 6×7 grid for `anchor`'s month, starting from the first
 * `WEEK_STARTS_ON` weekday on or before the month's first day. */
export function getMonthGridDays(anchor: Date): Date[] {
  const monthStart = startOfMonth(anchor);
  const leadingDays = (monthStart.getDay() - WEEK_STARTS_ON + 7) % 7;
  const gridStart = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth(),
    monthStart.getDate() - leadingDays,
  );
  return Array.from({ length: GRID_CELLS }, (_, index) => {
    return new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
  });
}

/** Short weekday labels (e.g. "Sun"…"Sat") ordered from `WEEK_STARTS_ON`. */
export const WEEKDAY_LABELS = Array.from({ length: 7 }, (_, index) => {
  // 2023-01-01 is a Sunday, so it anchors the label sequence.
  const day = new Date(2023, 0, 1 + WEEK_STARTS_ON + index);
  return day.toLocaleDateString("en-US", { weekday: "short" });
});

/** The 7 days of the week containing `anchor`, from `WEEK_STARTS_ON`. */
export function getWeekDays(anchor: Date): Date[] {
  const weekStart = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

/** Toolbar title for a month, e.g. "August 2026". */
export function formatMonthTitle(anchor: Date): string {
  return anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Toolbar title for a week, e.g. "Aug 17 – 23, 2026" or, across a month/year
 * boundary, "Aug 31 – Sep 6, 2026". */
export function formatWeekTitle(anchor: Date): string {
  const start = startOfWeek(anchor);
  const end = addDays(start, 6);
  const sameMonth = isSameMonth(start, end);
  const sameYear = start.getFullYear() === end.getFullYear();
  const startText = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  const endText = end.toLocaleDateString("en-US", {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    year: "numeric",
  });
  return `${startText} – ${endText}`;
}

/** Hours of the day (0–23) for the week-view time gutter and gridlines. */
export const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** Short hour label for the gutter, e.g. "1am", "12pm". */
export function formatHourLabel(hour: number): string {
  return new Date(2023, 0, 1, hour)
    .toLocaleTimeString("en-US", { hour: "numeric" })
    .replace(" ", "")
    .toLowerCase();
}
