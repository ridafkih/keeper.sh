/** 0 = Sunday, as `Date#getDay`. */
export const WEEK_STARTS_ON = 0;

export const MONTH_VIEW_ROWS = 6;

export const WEEK_VIEW_DAYS = 7;

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** First day of the week view's rolling range centred on `anchor`. */
export function startOfVisibleWeek(anchor: Date): Date {
  return addDays(anchor, -Math.floor(WEEK_VIEW_DAYS / 2));
}

export function startOfWeek(date: Date): Date {
  const offset = (date.getDay() - WEEK_STARTS_ON + 7) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Top row of the month's classic layout: the week holding the 1st. */
export function startOfMonthGrid(anchor: Date): Date {
  return startOfWeek(startOfMonth(anchor));
}

/** Middle of the month view's visible days; its month is the one filling most of the viewport. */
export function getMonthViewFocusDay(topWeekStart: Date): Date {
  return addDays(topWeekStart, (MONTH_VIEW_ROWS * 7) / 2 - 1);
}

export const WEEKDAY_LABELS = Array.from({ length: 7 }, (_, index) => {
  // 2023-01-01 is a Sunday, so it anchors the label sequence.
  const day = new Date(2023, 0, 1 + WEEK_STARTS_ON + index);
  return day.toLocaleDateString("en-US", { weekday: "short" });
});

export function formatMonthTitle(anchor: Date): string {
  return anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// Composed by hand: Intl has no day+year-without-month format ("Aug 19 – 25, 2026").
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

const FETCH_WEEKS_BEFORE = 1;
const FETCH_WEEKS = 4;

/** Half-open `[start, end)` quantised to calendar weeks, so a ±7-day page stays inside the previous window while the next loads. */
export function getWeekFetchRange(anchor: Date): { start: Date; end: Date } {
  const start = addDays(startOfWeek(startOfVisibleWeek(anchor)), -FETCH_WEEKS_BEFORE * 7);
  return { start, end: addDays(start, FETCH_WEEKS * 7) };
}

/** Half-open `[start, end)` over the classic layouts of the months either side, so the window holds still while rows scroll and a ±1-month page stays inside it while the next loads. */
export function getMonthFetchRange(anchor: Date): { start: Date; end: Date } {
  const month = startOfMonth(anchor);
  return {
    start: startOfMonthGrid(addMonths(month, -1)),
    end: addDays(startOfMonthGrid(addMonths(month, 1)), MONTH_VIEW_ROWS * 7),
  };
}

export const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export const HOUR_HEIGHT = 48;

export function formatHourLabel(hour: number): string {
  return new Date(2023, 0, 1, hour)
    .toLocaleTimeString("en-US", { hour: "numeric" })
    .replace(" ", "")
    .toLowerCase();
}
