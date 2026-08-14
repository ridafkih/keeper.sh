import { DEFAULT_FEED_SETTINGS } from "@keeper.sh/data-schemas";
import { canAddMore } from "@/hooks/use-entitlements";
import type { EntitlementLimit } from "@/hooks/use-entitlements";
import type { CalendarSource } from "@/types/api";

const resolvePickableCalendars = (sources: CalendarSource[]): CalendarSource[] =>
  sources.filter((source) => source.capabilities.includes("pull"));

const canCreateFeed = (
  entitlements: { feeds?: EntitlementLimit } | undefined,
): boolean => canAddMore(entitlements?.feeds);

interface FeedDisclosureSettings {
  includeEventName: boolean;
  includeEventDescription: boolean;
  includeEventLocation: boolean;
}

const SINGLE_DETAIL_COUNT = 1;
const LAST_DETAIL_OFFSET = 1;

const formatDetailList = (details: string[]): string => {
  if (details.length === SINGLE_DETAIL_COUNT) {
    return details[0] ?? "";
  }

  const leading = details.slice(0, details.length - LAST_DETAIL_OFFSET);
  const last = details[details.length - LAST_DETAIL_OFFSET] ?? "";
  return `${leading.join(", ")} and ${last}`;
};

const resolveFeedDisclosure = (settings: FeedDisclosureSettings): string => {
  const details = [
    "times",
    ...(settings.includeEventName ? ["names"] : []),
    ...(settings.includeEventDescription ? ["descriptions"] : []),
    ...(settings.includeEventLocation ? ["locations"] : []),
  ];

  if (details.length === SINGLE_DETAIL_COUNT) {
    return "This link shares event times only.";
  }

  return `This link shares event ${formatDetailList(details)}.`;
};

const EVENT_NAME_TEMPLATE = "{{event_name}}";

type EventNamePatch = {
  includeEventName: boolean;
  customEventName: string;
};

/* Hiding event names leaves the feed with nothing to title an event with, so the
 * placeholder is written alongside the toggle rather than left to the renderer. */
const resolveEventNamePatch = (includeEventName: boolean): EventNamePatch => {
  if (includeEventName) {
    return { includeEventName: true, customEventName: EVENT_NAME_TEMPLATE };
  }
  return { includeEventName: false, customEventName: DEFAULT_FEED_SETTINGS.customEventName };
};

const resolveCalendarSelection = (
  selected: Iterable<string>,
  calendarId: string,
  checked: boolean,
): string[] => {
  const current = [...selected];
  if (!checked) {
    return current.filter((id) => id !== calendarId);
  }
  if (current.includes(calendarId)) {
    return current;
  }
  return [...current, calendarId];
};

interface FeedNeighbours<TFeed> {
  previous: TFeed | null;
  next: TFeed | null;
}

const NOT_FOUND_INDEX = -1;
const NEIGHBOUR_OFFSET = 1;

const resolveFeedNeighbours = <TFeed extends { id: string }>(
  feeds: TFeed[],
  feedId: string,
): FeedNeighbours<TFeed> => {
  const index = feeds.findIndex((feed) => feed.id === feedId);
  if (index === NOT_FOUND_INDEX) {
    return { previous: null, next: null };
  }

  return {
    previous: feeds[index - NEIGHBOUR_OFFSET] ?? null,
    next: feeds[index + NEIGHBOUR_OFFSET] ?? null,
  };
};

export {
  canCreateFeed,
  resolveCalendarSelection,
  resolveEventNamePatch,
  resolveFeedDisclosure,
  resolveFeedNeighbours,
  resolvePickableCalendars,
};
export type { FeedDisclosureSettings };
