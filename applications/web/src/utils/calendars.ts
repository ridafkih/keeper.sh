interface CalendarLike {
  capabilities: string[];
}

export const canPull = (calendar: CalendarLike): boolean =>
  calendar.capabilities.includes("pull");

export const canPush = (calendar: CalendarLike): boolean =>
  calendar.capabilities.includes("push");
