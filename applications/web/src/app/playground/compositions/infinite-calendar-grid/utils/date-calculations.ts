const DAYS_PER_WEEK = 7;

type WeekStartDay = 0 | 1; // 0 = Sunday, 1 = Monday

interface WeekRange {
  startDate: Date;
  days: Date[];
}

const getWeekStart = (date: Date, weekStartDay: WeekStartDay = 0): Date => {
  const result = new Date(date);
  const dayOfWeek = result.getDay();
  const diff = (dayOfWeek - weekStartDay + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  result.setDate(result.getDate() - diff);
  result.setHours(0, 0, 0, 0);
  return result;
};

const getWeekForRow = (
  anchorDate: Date,
  rowOffset: number,
  weekStartDay: WeekStartDay = 0
): WeekRange => {
  const anchorWeekStart = getWeekStart(anchorDate, weekStartDay);
  const rowWeekStart = new Date(anchorWeekStart);
  rowWeekStart.setDate(rowWeekStart.getDate() + rowOffset * DAYS_PER_WEEK);

  const days: Date[] = [];
  for (let i = 0; i < DAYS_PER_WEEK; i++) {
    const day = new Date(rowWeekStart);
    day.setDate(day.getDate() + i);
    days.push(day);
  }

  return { startDate: rowWeekStart, days };
};

const isToday = (date: Date): boolean => {
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
};

const formatDayNumber = (date: Date): string => {
  return date.getDate().toString();
};

const getWeekdayHeaders = (weekStartDay: WeekStartDay = 0): string[] => {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
  if (weekStartDay === 1) {
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  }
  return [...days];
};

export { getWeekStart, getWeekForRow, isToday, formatDayNumber, getWeekdayHeaders };
export type { WeekStartDay, WeekRange };
