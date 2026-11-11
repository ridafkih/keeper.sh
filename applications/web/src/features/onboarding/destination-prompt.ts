interface PromptCalendar {
  calendarType: string;
  capabilities: string[];
}

type DestinationPrompt<TCalendar extends PromptCalendar> =
  | { kind: "same-account"; suggested: TCalendar; alternatives: TCalendar[] }
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
  const [suggested, ...alternatives] = sameAccountDestinations;
  if (suggested) return { alternatives, kind: "same-account", suggested };
  if (calendars.some(isWritable)) return { kind: "connect" };
  if (calendars.every(isCalendarLink)) return { kind: "read-only-links" };
  return { kind: "read-only" };
};

export { resolveDestinationPrompt };
export type { DestinationPrompt, PromptCalendar };
