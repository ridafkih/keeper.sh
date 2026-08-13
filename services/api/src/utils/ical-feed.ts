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
import { formatEventsAsIcal } from "./ical-format";
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

const DEFAULT_FEED_SETTINGS: FeedSettings = {
  includeEventName: false,
  includeEventDescription: false,
  includeEventLocation: false,
  excludeAllDayEvents: false,
  customEventName: "Busy",
};

type StoredFeedEvent = Omit<
  CalendarEvent,
  "exceptionDates" | "recurrenceDuration" | "recurrenceRule"
> & {
  exceptionDates: string | null;
  recurrenceRule: string | null;
};

interface FeedDependencies {
  now?: Date;
  resolveUserIdentifier: (identifier: string) => Promise<string | null>;
  readFeedSettings: (userId: string) => Promise<FeedSettings | null>;
  readFeedCalendars: (userId: string) => Promise<FeedCalendar[]>;
  readFeedEvents: (
    calendarIds: string[],
    query: IcalFeedQuery,
  ) => Promise<StoredFeedEvent[]>;
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
}

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

const generateCalendarFeed = async (
  identifier: string,
  dependencies: FeedDependencies,
  ifNoneMatch: string | null = null,
): Promise<FeedResponse | null> => {
  const userId = await dependencies.resolveUserIdentifier(identifier);

  if (!userId) {
    return null;
  }

  const [settings, calendars] = await Promise.all([
    dependencies.readFeedSettings(userId),
    dependencies.readFeedCalendars(userId),
  ]);

  const feedSettings = settings ?? DEFAULT_FEED_SETTINGS;

  if (calendars.length === 0) {
    const body = formatEventsAsIcal([], feedSettings);
    return { body, etag: buildFeedEtag("", feedSettings), eventCount: 0 };
  }

  const calendarIds = calendars.map(({ id }) => id);
  const query = createIcalFeedQuery(calendars, dependencies.now);
  const etag = buildFeedEtag(
    await dependencies.readFeedRevision(calendarIds, query),
    feedSettings,
  );

  if (ifNoneMatch === etag) {
    return { body: null, etag, eventCount: 0 };
  }

  const rows = await dependencies.readFeedEvents(calendarIds, query);

  return {
    body: formatEventsAsIcal(rows.map((row) => toCalendarEvent(row)), feedSettings),
    etag,
    eventCount: rows.length,
  };
};

export {
  DEFAULT_FEED_SETTINGS,
  createIcalFeedQuery,
  generateCalendarFeed,
};
export type { FeedDependencies, FeedResponse, IcalFeedQuery, StoredFeedEvent };
