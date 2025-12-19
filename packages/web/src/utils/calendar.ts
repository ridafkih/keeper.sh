export const HOURS = Array.from({ length: 24 }, (_, index) => index);

export type EventColor = "blue" | "green" | "purple" | "orange";

const EVENT_COLORS: EventColor[] = ["blue", "green", "purple", "orange"];

/**
 * Hash a string using djb2 algorithm for consistent color generation
 */
const hashString = (str: string): number => {
  let hash = 5381;
  for (let index = 0; index < str.length; index++) {
    hash = (hash * 33) ^ str.charCodeAt(index);
  }
  return hash >>> 0;
};

/**
 * Generate a consistent color from a source URL
 */
export const getColorFromUrl = (url: string | undefined): EventColor => {
  if (!url) return "blue";
  const hash = hashString(url);
  return EVENT_COLORS[hash % EVENT_COLORS.length] ?? "blue";
};

export function getDaysFromDate(startDate: Date, count: number) {
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(startDate);
    date.setDate(date.getDate() + offset);
    return date;
  });
}

export function isToday(date: Date) {
  return new Date().toDateString() === date.toDateString();
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatWeekday(date: Date) {
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

export function formatHour(hour: number) {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatDayHeading(date: Date): string {
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

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
