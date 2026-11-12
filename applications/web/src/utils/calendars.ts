import { normalizeTitleKeywords } from "@keeper.sh/data-schemas";
import type { ExcludableAvailability } from "@keeper.sh/data-schemas";

interface CalendarLike {
  capabilities: string[];
  provider?: string | null;
  calendarType: string;
}

export const canPull = (calendar: CalendarLike): boolean =>
  calendar.capabilities.includes("pull");

export const canPush = (calendar: CalendarLike): boolean =>
  calendar.capabilities.includes("push");

export const isMissingAtProvider = (calendar: {
  providerMissingSince: string | null;
  unavailableSince: string | null;
}): boolean => calendar.providerMissingSince !== null || calendar.unavailableSince !== null;

export const getCalendarProvider = (
  calendar: Pick<CalendarLike, "provider" | "calendarType">,
): string => calendar.provider ?? calendar.calendarType;

export const toggleExcludedAvailability = (
  excluded: readonly ExcludableAvailability[],
  availability: ExcludableAvailability,
): ExcludableAvailability[] => {
  if (excluded.includes(availability)) {
    return excluded.filter((value) => value !== availability);
  }
  return [...excluded, availability];
};

const TITLE_KEYWORD_SEPARATOR = ",";

export const parseTitleKeywords = (value: string): string[] =>
  normalizeTitleKeywords(value.split(TITLE_KEYWORD_SEPARATOR));

export const areTitleKeywordsEqual = (
  first: readonly string[],
  second: readonly string[],
): boolean =>
  first.length === second.length && first.every((keyword, index) => keyword === second[index]);

export const formatTitleKeywords = (keywords: string[]): string =>
  keywords.join(`${TITLE_KEYWORD_SEPARATOR} `);
