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

/** Toolbar title for a month, e.g. "August 2026". */
export function formatMonthTitle(anchor: Date): string {
  return anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
