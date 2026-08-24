import {
  DEFAULT_FUTURE_SYNC_RANGE,
  DEFAULT_HISTORIC_SYNC_RANGE,
  getConfigurableSyncWindow,
  getSyncRangeOrder,
  parseStoredIcsExceptionDates,
  parseStoredIcsRecurrence,
} from "@keeper.sh/calendar";
import { syncRangeSchema } from "@keeper.sh/data-schemas";
import type { SyncRange } from "@keeper.sh/data-schemas";
import { formatEventsAsIcal, shouldIncludeEvent } from "./ical-format";
import type { CalendarEvent, FeedSettings } from "./ical-format";

/**
 * A published feed is fetched whole on every poll and the ICS subscription
 * protocol has no pagination, so the horizon is the only thing that bounds it.
 * That horizon follows the widest range configured across the feed's own
 * calendars, so the feed carries exactly the events the user asked to keep. It
 * is deliberately not capped beyond that: a cap silently drops events a
 * subscriber is relying on, and a feed missing a meeting is worse than a large
 * one.
 */
interface FeedCalendar {
  id: string;
  syncFutureRange: string;
  syncHistoricRange: string;
}

interface IcalFeedQuery {
  windowEnd: Date;
  windowStart: Date;
}

const parseSyncRange = (value: string, calendarId: string): SyncRange => {
  if (!syncRangeSchema.allows(value)) {
    throw new Error(`Calendar ${calendarId} stores an unknown sync range "${value}"`);
  }
  return value;
};

/*
 * The floor is the product default rather than a fallback: a feed is never
 * narrower than that, however its calendars are configured.
 */
const widestSyncRange = (floor: SyncRange, ranges: SyncRange[]): SyncRange =>
  [floor, ...ranges]
    .toSorted((first, second) => getSyncRangeOrder(second) - getSyncRangeOrder(first))
    .at(0) ?? floor;

const createIcalFeedQuery = (
  calendars: FeedCalendar[],
  now: Date = new Date(),
): IcalFeedQuery => {
  const window = getConfigurableSyncWindow(
    widestSyncRange(
      DEFAULT_HISTORIC_SYNC_RANGE,
      calendars.map(({ id, syncHistoricRange }) => parseSyncRange(syncHistoricRange, id)),
    ),
    widestSyncRange(
      DEFAULT_FUTURE_SYNC_RANGE,
      calendars.map(({ id, syncFutureRange }) => parseSyncRange(syncFutureRange, id)),
    ),
    now,
  );

  return {
    windowEnd: window.timeMax,
    windowStart: window.timeMin,
  };
};

type StoredFeedEvent = Omit<
  CalendarEvent,
  "exceptionDates" | "recurrenceDuration" | "recurrenceRule"
> & {
  exceptionDates: string | null;
  recurrenceRule: string | null;
};

/* Rows the feed's own policy keeps out of the body, counted per reason. */
interface FeedExclusionCounts {
  workingLocation: number;
  workingElsewhere: number;
}

interface FeedWithheldCounts extends FeedExclusionCounts {
  allDay: number;
  focusTime: number;
  outOfOffice: number;
}

/*
 * A feed, not a user, is what an identifier resolves to: one account can
 * publish several, each with its own calendar selection and settings.
 */
interface ResolvedFeedIdentity<TScope> {
  scope: TScope;
  settings: FeedSettings;
}

interface FeedDependencies<TScope> {
  now?: Date;
  resolveFeed: (identifier: string) => Promise<ResolvedFeedIdentity<TScope> | null>;
  readFeedCalendars: (scope: TScope) => Promise<FeedCalendar[]>;
  readFeedEvents: (
    calendarIds: string[],
    query: IcalFeedQuery,
  ) => Promise<StoredFeedEvent[]>;
  readFeedExclusions: (
    calendarIds: string[],
    query: IcalFeedQuery,
  ) => Promise<FeedExclusionCounts>;
  readFeedRevision: (
    calendarIds: string[],
    query: IcalFeedQuery,
  ) => Promise<string>;
}

/* A null body means the caller's validator still matches and nothing was read. */
interface FeedResponse {
  body: string | null;
  etag: string;
  eventCount: number;
  withheld: FeedWithheldCounts;
}

const NOTHING_WITHHELD: FeedWithheldCounts = {
  allDay: 0,
  focusTime: 0,
  outOfOffice: 0,
  workingElsewhere: 0,
  workingLocation: 0,
};

const NO_EVENT_FILTERS = {
  excludeAllDayEvents: false,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
} as const;

type EventFilter = keyof typeof NO_EVENT_FILTERS;

/*
 * Each reason is counted with only its own filter enabled, so an event two
 * filters would both drop lands in both buckets rather than whichever the
 * combined predicate happened to reject it for first.
 */
const countWithheldBy = (
  events: CalendarEvent[],
  settings: FeedSettings,
  filter: EventFilter,
): number => events.filter((event) =>
  !shouldIncludeEvent(event, { ...settings, ...NO_EVENT_FILTERS, [filter]: settings[filter] })).length;

/*
 * Settings decide what each event renders as, so two feeds over identical rows
 * are not interchangeable. Only the fields that reach the output are folded in,
 * keeping the validator stable when an unrelated column on the settings row
 * changes. The field separator cannot appear in a name, so no combination of
 * values can produce another combination's digest.
 */
const describeFeedSettings = (settings: FeedSettings): string => [
  settings.includeEventName,
  settings.includeEventDescription,
  settings.includeEventLocation,
  settings.excludeAllDayEvents,
  settings.excludeFocusTime,
  settings.excludeOutOfOffice,
  settings.customEventName,
].join("\u001F");

const buildFeedEtag = (revision: string, settings: FeedSettings): string => {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(revision);
  hasher.update(describeFeedSettings(settings));
  return `"${hasher.digest("hex")}"`;
};

const toCalendarEvent = (row: StoredFeedEvent): CalendarEvent => {
  const recurrence = parseStoredIcsRecurrence(row.recurrenceRule, row.id);
  return {
    ...row,
    recurrenceDuration: recurrence?.recurrenceDuration ?? null,
    recurrenceRule: recurrence?.recurrenceRule ?? null,
    exceptionDates: parseStoredIcsExceptionDates(row.exceptionDates, row.id),
  };
};

const generateCalendarFeed = async <TScope>(
  identifier: string,
  dependencies: FeedDependencies<TScope>,
  ifNoneMatch: string | null = null,
): Promise<FeedResponse | null> => {
  const feed = await dependencies.resolveFeed(identifier);

  if (!feed) {
    return null;
  }

  const feedSettings = feed.settings;
  const calendars = await dependencies.readFeedCalendars(feed.scope);

  if (calendars.length === 0) {
    const body = formatEventsAsIcal([], feedSettings);
    return {
      body,
      etag: buildFeedEtag("", feedSettings),
      eventCount: 0,
      withheld: NOTHING_WITHHELD,
    };
  }

  const calendarIds = calendars.map(({ id }) => id);
  const query = createIcalFeedQuery(calendars, dependencies.now);
  const etag = buildFeedEtag(
    await dependencies.readFeedRevision(calendarIds, query),
    feedSettings,
  );

  if (ifNoneMatch === etag) {
    return { body: null, etag, eventCount: 0, withheld: NOTHING_WITHHELD };
  }

  const [rows, exclusions] = await Promise.all([
    dependencies.readFeedEvents(calendarIds, query),
    dependencies.readFeedExclusions(calendarIds, query),
  ]);

  const events = rows.map((row) => toCalendarEvent(row));

  return {
    body: formatEventsAsIcal(events, feedSettings),
    etag,
    eventCount: rows.length,
    withheld: {
      ...exclusions,
      allDay: countWithheldBy(events, feedSettings, "excludeAllDayEvents"),
      focusTime: countWithheldBy(events, feedSettings, "excludeFocusTime"),
      outOfOffice: countWithheldBy(events, feedSettings, "excludeOutOfOffice"),
    },
  };
};

export {
  createIcalFeedQuery,
  generateCalendarFeed,
};
export type {
  FeedDependencies,
  FeedExclusionCounts,
  FeedResponse,
  FeedWithheldCounts,
  IcalFeedQuery,
  ResolvedFeedIdentity,
  StoredFeedEvent,
};
