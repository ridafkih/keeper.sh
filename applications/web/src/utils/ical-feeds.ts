import { canAddMore } from "@/hooks/use-entitlements";
import type { EntitlementLimit } from "@/hooks/use-entitlements";
import type { CalendarSource } from "@/types/api";

interface CalendarGroup {
  accountId: string;
  label: string;
  calendars: CalendarSource[];
}

const groupCalendarsByAccount = (sources: CalendarSource[]): CalendarGroup[] => {
  const groups: CalendarGroup[] = [];
  const groupsByAccountId = new Map<string, CalendarGroup>();

  for (const source of sources) {
    if (!source.capabilities.includes("pull")) {
      continue;
    }

    const existing = groupsByAccountId.get(source.accountId);
    if (existing) {
      existing.calendars.push(source);
      continue;
    }

    const group: CalendarGroup = {
      accountId: source.accountId,
      label: source.accountLabel,
      calendars: [source],
    };
    groupsByAccountId.set(source.accountId, group);
    groups.push(group);
  }

  return groups;
};

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

export { canCreateFeed, groupCalendarsByAccount, resolveFeedDisclosure };
export type { CalendarGroup, FeedDisclosureSettings };
