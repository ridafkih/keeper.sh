interface PromptCalendar {
  calendarType: string;
  capabilities: string[];
}

type DestinationPrompt<TCalendar extends PromptCalendar> =
  | { kind: "same-account"; destinations: TCalendar[] }
  | { kind: "read-only-links" }
  | { kind: "read-only" }
  | { kind: "connect" };

const ICAL_LINK_CALENDAR_TYPE = "ical";

const isWritable = (calendar: PromptCalendar): boolean => calendar.capabilities.includes("push");

const isCalendarLink = (calendar: PromptCalendar): boolean => calendar.calendarType === ICAL_LINK_CALENDAR_TYPE;

const resolveDestinationPrompt = <TCalendar extends PromptCalendar>(
  calendars: TCalendar[],
  sameAccountDestinations: TCalendar[],
): DestinationPrompt<TCalendar> => {
  if (sameAccountDestinations.length > 0) return { destinations: sameAccountDestinations, kind: "same-account" };
  if (calendars.some(isWritable)) return { kind: "connect" };
  if (calendars.every(isCalendarLink)) return { kind: "read-only-links" };
  return { kind: "read-only" };
};

export { resolveDestinationPrompt };
export type { DestinationPrompt, PromptCalendar };
