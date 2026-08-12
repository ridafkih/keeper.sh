import type { GoogleCalendarListEntry } from "@keeper.sh/data-schemas";
import { normalizeCalDAVCalendarKey } from "../../providers/caldav/shared/calendar-identity";
import type { CalendarInfo } from "../../providers/caldav/types";

type RediscoveryCalendarType = "caldav" | "oauth";

interface DiscoveredCalendar {
  identityKey: string;
  name: string;
  writable: boolean;
  externalCalendarId: string | null;
  calendarUrl: string | null;
}

interface ExistingCalendar {
  id: string;
  identityKey: string;
  calendarUrl: string | null;
  unavailableSince: Date | null;
  createdAt: Date;
}

interface CalendarRetarget {
  id: string;
  calendarUrl: string;
}

interface CalendarRediscoveryPlan {
  toInsert: DiscoveredCalendar[];
  toRevive: string[];
  toMarkUnavailable: string[];
  toRetargetUrl: CalendarRetarget[];
  unchangedCount: number;
  duplicateCount: number;
  crossAccountSkippedCount: number;
  suppressed: boolean;
}

interface CalendarRediscoveryInput {
  discovered: DiscoveredCalendar[];
  existing: ExistingCalendar[];
  blockedKeys?: ReadonlySet<string>;
  enumerationStartedAt?: Date;
}

interface StoredCalendarRow {
  id: string;
  calendarUrl: string | null;
  externalCalendarId: string | null;
  unavailableSince: Date | null;
  createdAt: Date;
}

interface OutlookCalendarEntry {
  id: string;
  name: string;
  canEdit?: boolean;
}

const GOOGLE_WRITABLE_ROLES = new Set(["owner", "writer"]);

const EMPTY_PLAN: CalendarRediscoveryPlan = {
  crossAccountSkippedCount: 0,
  duplicateCount: 0,
  suppressed: false,
  toInsert: [],
  toMarkUnavailable: [],
  toRetargetUrl: [],
  toRevive: [],
  unchangedCount: 0,
};

const isOlder = (candidate: ExistingCalendar, incumbent: ExistingCalendar): boolean =>
  candidate.createdAt.getTime() < incumbent.createdAt.getTime();

const indexExistingByKey = (
  existing: ExistingCalendar[],
): { byKey: Map<string, ExistingCalendar>; duplicateCount: number } => {
  const byKey = new Map<string, ExistingCalendar>();
  let duplicateCount = 0;

  for (const calendar of existing) {
    const incumbent = byKey.get(calendar.identityKey);
    if (!incumbent) {
      byKey.set(calendar.identityKey, calendar);
      continue;
    }
    duplicateCount += 1;
    if (isOlder(calendar, incumbent)) {
      byKey.set(calendar.identityKey, calendar);
    }
  }

  return { byKey, duplicateCount };
};

const dedupeDiscoveredByKey = (
  discovered: DiscoveredCalendar[],
): { unique: DiscoveredCalendar[]; duplicateCount: number } => {
  const seen = new Set<string>();
  const unique = discovered.filter((calendar) => {
    if (seen.has(calendar.identityKey)) {
      return false;
    }
    seen.add(calendar.identityKey);
    return true;
  });

  return { duplicateCount: discovered.length - unique.length, unique };
};

const matchDiscoveredCalendar = (
  calendar: DiscoveredCalendar,
  byKey: Map<string, ExistingCalendar>,
): { calendar: DiscoveredCalendar; match: ExistingCalendar }[] => {
  const match = byKey.get(calendar.identityKey);
  if (!match) {
    return [];
  }
  return [{ calendar, match }];
};

const predatesEnumeration = (
  calendar: ExistingCalendar,
  enumerationStartedAt: Date | undefined,
): boolean =>
  !enumerationStartedAt
  || calendar.createdAt.getTime() <= enumerationStartedAt.getTime();

const buildUrlRetarget = (
  calendar: DiscoveredCalendar,
  match: ExistingCalendar,
): CalendarRetarget[] => {
  if (calendar.calendarUrl === null || calendar.calendarUrl === match.calendarUrl) {
    return [];
  }
  return [{ calendarUrl: calendar.calendarUrl, id: match.id }];
};

const planCalendarRediscovery = (
  input: CalendarRediscoveryInput,
): CalendarRediscoveryPlan => {
  const { byKey, duplicateCount: existingDuplicateCount } = indexExistingByKey(input.existing);
  const { unique, duplicateCount: discoveredDuplicateCount } =
    dedupeDiscoveredByKey(input.discovered);
  const duplicateCount = existingDuplicateCount + discoveredDuplicateCount;
  const blockedKeys = input.blockedKeys ?? new Set<string>();

  if (input.discovered.length === 0 && input.existing.length > 0) {
    return { ...EMPTY_PLAN, duplicateCount, suppressed: true };
  }

  const matched = unique.flatMap(
    (calendar) => matchDiscoveredCalendar(calendar, byKey),
  );
  const matchedIds = new Set(matched.map(({ match }) => match.id));

  const unmatched = unique.filter(
    (calendar) => !byKey.has(calendar.identityKey),
  );
  const toInsert = unmatched.filter((calendar) => !blockedKeys.has(calendar.identityKey));

  const survivors = [...byKey.values()];

  return {
    crossAccountSkippedCount: unmatched.length - toInsert.length,
    duplicateCount,
    suppressed: false,
    toInsert,
    toMarkUnavailable: survivors
      .filter((calendar) =>
        !matchedIds.has(calendar.id)
        && calendar.unavailableSince === null
        && predatesEnumeration(calendar, input.enumerationStartedAt))
      .map(({ id }) => id),
    toRetargetUrl: matched.flatMap(
      ({ calendar, match }) => buildUrlRetarget(calendar, match),
    ),
    toRevive: matched
      .filter(({ match }) => match.unavailableSince !== null)
      .map(({ match }) => match.id),
    unchangedCount: matched.length,
  };
};

const toDiscoveredGoogleCalendars = (
  entries: GoogleCalendarListEntry[],
): DiscoveredCalendar[] =>
  entries.map((entry) => ({
    calendarUrl: null,
    externalCalendarId: entry.id,
    identityKey: entry.id,
    name: entry.summary ?? entry.id,
    writable: GOOGLE_WRITABLE_ROLES.has(entry.accessRole),
  }));

const toDiscoveredOutlookCalendars = (
  entries: OutlookCalendarEntry[],
): DiscoveredCalendar[] =>
  entries.map((entry) => ({
    calendarUrl: null,
    externalCalendarId: entry.id,
    identityKey: entry.id,
    name: entry.name,
    writable: entry.canEdit === true,
  }));

const toDiscoveredCalDAVCalendars = (
  entries: CalendarInfo[],
): DiscoveredCalendar[] =>
  entries.map((entry) => ({
    calendarUrl: entry.url,
    externalCalendarId: null,
    identityKey: normalizeCalDAVCalendarKey(entry.url),
    name: entry.displayName,
    writable: true,
  }));

const resolveStoredIdentityKey = (
  row: StoredCalendarRow,
  calendarType: RediscoveryCalendarType,
): string[] => {
  if (calendarType === "oauth") {
    if (!row.externalCalendarId) {
      return [];
    }
    return [row.externalCalendarId];
  }

  if (!row.calendarUrl) {
    return [];
  }

  try {
    return [normalizeCalDAVCalendarKey(row.calendarUrl)];
  } catch (error) {
    throw new Error(`Calendar ${row.id} has an unparseable calendarUrl`, { cause: error });
  }
};

const toExistingCalendars = (
  rows: StoredCalendarRow[],
  calendarType: RediscoveryCalendarType,
): ExistingCalendar[] =>
  rows.flatMap((row) =>
    resolveStoredIdentityKey(row, calendarType).map((identityKey) => ({
      calendarUrl: row.calendarUrl,
      createdAt: row.createdAt,
      id: row.id,
      identityKey,
      unavailableSince: row.unavailableSince,
    })));

const resolveRediscoveryCalendarType = (authType: string): RediscoveryCalendarType => {
  if (authType === "caldav") {
    return "caldav";
  }

  return "oauth";
};

export {
  planCalendarRediscovery,
  resolveRediscoveryCalendarType,
  toDiscoveredCalDAVCalendars,
  toDiscoveredGoogleCalendars,
  toDiscoveredOutlookCalendars,
  toExistingCalendars,
};
export type {
  CalendarRediscoveryPlan,
  CalendarRetarget,
  DiscoveredCalendar,
  ExistingCalendar,
  RediscoveryCalendarType,
  StoredCalendarRow,
};
