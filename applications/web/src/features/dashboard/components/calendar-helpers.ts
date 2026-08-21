/**
 * Native-`Date` helpers for the month calendar grid. Keeper does not depend on
 * `date-fns`, so the grid math is done with the standard `Date`/`Intl` APIs,
 * matching the day-offset approach already used in `event-graph.tsx`.
 */

/** First column of the week. 0 = Sunday, 1 = Monday. */
export const WEEK_STARTS_ON = 0;

/** Cells in a fixed 6×7 month grid. */
const GRID_CELLS = 42;

/** Day columns shown at once in the week view. */
export const WEEK_VIEW_DAYS = 7;

/** Midnight on `date`'s day. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

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

/** First day of the week view's rolling range when it is centred on `anchor`:
 * `anchor` sits in the middle column, with the same number of days either
 * side (3 for a 7-day view). Midnight. */
export function startOfVisibleWeek(anchor: Date): Date {
  return addDays(anchor, -Math.floor(WEEK_VIEW_DAYS / 2));
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

/** Toolbar title for the week view's rolling range centred on `anchor`, e.g.
 * "Aug 19 – 25, 2026", "Aug 29 – Sep 4, 2026" across a month boundary, or
 * "Dec 29, 2025 – Jan 4, 2026" across a year.
 *
 * Numeric day/year parts are composed directly rather than via
 * `toLocaleDateString`, because asking Intl for a day+year format with no month
 * ("Aug 19 – 25, 2026") renders an unsupported fallback like "2026 (day: 25)". */
export function formatWeekTitle(anchor: Date): string {
  const start = startOfVisibleWeek(anchor);
  const end = addDays(start, WEEK_VIEW_DAYS - 1);
  const startMonth = start.toLocaleDateString("en-US", { month: "short" });
  const endMonth = end.toLocaleDateString("en-US", { month: "short" });

  if (isSameMonth(start, end)) {
    return `${startMonth} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${startMonth} ${start.getDate()}, ${start.getFullYear()} – ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
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
