export interface CalendarLike {
  capabilities: string[];
}

export const canPull = (calendar: CalendarLike): boolean =>
  calendar.capabilities.includes("pull");

export const canPush = (calendar: CalendarLike): boolean =>
  calendar.capabilities.includes("push");

export const isMissingAtProvider = (calendar: {
  providerMissingSince: string | null;
  unavailableSince: string | null;
}): boolean => calendar.providerMissingSince !== null || calendar.unavailableSince !== null;

