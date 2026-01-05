import { MS_PER_WEEK } from "@keeper.sh/constants";

export const getStartOfToday = (): Date => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

export const isSameDay = (first: Date, second: Date): boolean => {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
};

export const getDaysFromDate = (startDate: Date, count: number): Date[] => {
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(startDate);
    date.setDate(date.getDate() + offset);
    return date;
  });
};

export const formatWeekday = (date: Date): string => {
  return date.toLocaleDateString("en-US", { weekday: "short" });
};

export const formatHour = (hour: number): string => {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
};

export const formatTime = (date: Date): string => {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

export const formatDate = (date: Date): string => {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
};

export const formatDayHeading = (date: Date): string => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

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

export interface DateRange {
  from: Date;
  to: Date;
}

export interface NormalizedDateRange {
  start: Date;
  end: Date;
}

export const parseDateRangeParams = (url: URL): DateRange => {
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const now = new Date();
  const from = fromParam ? new Date(fromParam) : now;
  const to = toParam
    ? new Date(toParam)
    : new Date(from.getTime() + MS_PER_WEEK);

  return { from, to };
};

export const normalizeDateRange = (
  from: Date,
  to: Date,
): NormalizedDateRange => {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);

  const end = new Date(to);
  end.setHours(23, 59, 59, 999);

  return { start, end };
};
