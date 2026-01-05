import { MS_PER_WEEK } from "@keeper.sh/constants";

const HOURS_START_OF_DAY = 0;
const MINUTES_START = 0;
const SECONDS_START = 0;
const MILLISECONDS_START = 0;
const HOURS_END_OF_DAY = 23;
const MINUTES_END = 59;
const SECONDS_END = 59;
const MILLISECONDS_END = 999;
const MIDNIGHT_HOUR = 0;
const NOON_HOUR = 12;
const DAY_OFFSET_INCREMENT = 1;
const HOURS_PER_HALF_DAY = 12;
const TWO_DIGIT_FORMAT = "2-digit" as const;

const getStartOfToday = (): Date => {
  const today = new Date();
  today.setHours(HOURS_START_OF_DAY, MINUTES_START, SECONDS_START, MILLISECONDS_START);
  return today;
};

const isSameDay = (first: Date, second: Date): boolean =>
  first.getFullYear() === second.getFullYear() &&
  first.getMonth() === second.getMonth() &&
  first.getDate() === second.getDate();

const getDaysFromDate = (startDate: Date, count: number): Date[] => {
  const days: Date[] = [];
  for (let offset = 0; offset < count; offset++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + offset);
    days.push(date);
  }
  return days;
};

const formatWeekday = (date: Date): string =>
  date.toLocaleDateString("en-US", { weekday: "short" });

const formatHour = (hour: number): string => {
  if (hour === MIDNIGHT_HOUR) {
    return "12 AM";
  }
  if (hour === NOON_HOUR) {
    return "12 PM";
  }
  if (hour < NOON_HOUR) {
    return `${hour} AM`;
  }
  return `${hour - HOURS_PER_HALF_DAY} PM`;
};

const formatTime = (date: Date): string =>
  date.toLocaleTimeString("en-US", {
    hour: "numeric",
    hour12: true,
    minute: TWO_DIGIT_FORMAT,
  });

const formatDate = (date: Date): string =>
  new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);

const formatDayHeading = (date: Date): string => {
  const today = new Date();
  today.setHours(HOURS_START_OF_DAY, MINUTES_START, SECONDS_START, MILLISECONDS_START);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + DAY_OFFSET_INCREMENT);

  if (isSameDay(date, today)) {
    return "Today";
  }

  if (isSameDay(date, tomorrow)) {
    return "Tomorrow";
  }

  const currentYear = today.getFullYear();
  const dateYear = date.getFullYear();

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(dateYear !== currentYear && { year: "numeric" }),
  });
};

interface DateRange {
  from: Date;
  to: Date;
}

interface NormalizedDateRange {
  start: Date;
  end: Date;
}

const parseDateRangeParams = (url: URL): DateRange => {
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const now = new Date();
  const from = ((): Date => {
    if (fromParam) {
      return new Date(fromParam);
    }
    return now;
  })();
  const to = ((): Date => {
    if (toParam) {
      return new Date(toParam);
    }
    return new Date(from.getTime() + MS_PER_WEEK);
  })();

  return { from, to };
};

const normalizeDateRange = (from: Date, to: Date): NormalizedDateRange => {
  const start = new Date(from);
  start.setHours(HOURS_START_OF_DAY, MINUTES_START, SECONDS_START, MILLISECONDS_START);

  const end = new Date(to);
  end.setHours(HOURS_END_OF_DAY, MINUTES_END, SECONDS_END, MILLISECONDS_END);

  return { end, start };
};

export {
  getStartOfToday,
  isSameDay,
  getDaysFromDate,
  formatWeekday,
  formatHour,
  formatTime,
  formatDate,
  formatDayHeading,
  parseDateRangeParams,
  normalizeDateRange,
};

export type { DateRange, NormalizedDateRange };
