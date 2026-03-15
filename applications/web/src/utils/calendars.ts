interface CalendarLike {
  capabilities: string[];
  provider?: string | null;
  calendarType: string;
}

export const canPull = (calendar: CalendarLike): boolean =>
  calendar.capabilities.includes("pull");

export const canPush = (calendar: CalendarLike): boolean =>
  calendar.capabilities.includes("push");

export const getCalendarProvider = (
  calendar: Pick<CalendarLike, "provider" | "calendarType">,
): string => calendar.provider ?? calendar.calendarType;
