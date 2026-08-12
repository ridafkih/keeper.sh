import {
  calendarsTable,
  eventStatesTable,
  icalFeedCalendarsTable,
  icalFeedsTable,
} from "@keeper.sh/database/schema";
import { and, asc, eq, gte, inArray, isNotNull, lte, ne, or, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { widelog } from "@/utils/logging";
import { generateCalendarFeed } from "./ical-feed";
import type { FeedExclusionCounts, FeedResponse, IcalFeedQuery } from "./ical-feed";
import type { FeedSettings } from "./ical-format";
import type { database as contextDatabase } from "@/context";

type FeedDatabaseClient = Pick<typeof contextDatabase, "select">;

const FIRST_RESULT_LIMIT = 1;

interface ResolvedFeed {
  feedId: string;
  userId: string;
  legacyAlias: boolean;
  settings: FeedSettings;
}

type FeedCalendarScope = Pick<ResolvedFeed, "feedId" | "userId">;

interface ResolveFeedIdentifierDependencies {
  findFeedByToken: (token: string) => Promise<ResolvedFeed | null>;
  resolveUserIdentifier: (identifier: string) => Promise<string | null>;
  findLegacyDefaultFeed: (userId: string) => Promise<ResolvedFeed | null>;
}

const FEED_COLUMNS = {
  feedId: icalFeedsTable.id,
  userId: icalFeedsTable.userId,
  legacyAlias: icalFeedsTable.legacyAlias,
  includeEventName: icalFeedsTable.includeEventName,
  includeEventDescription: icalFeedsTable.includeEventDescription,
  includeEventLocation: icalFeedsTable.includeEventLocation,
  excludeAllDayEvents: icalFeedsTable.excludeAllDayEvents,
  excludeFocusTime: icalFeedsTable.excludeFocusTime,
  excludeOutOfOffice: icalFeedsTable.excludeOutOfOffice,
  customEventName: icalFeedsTable.customEventName,
};

interface FeedRow {
  feedId: string;
  userId: string;
  legacyAlias: boolean;
  includeEventName: boolean;
  includeEventDescription: boolean;
  includeEventLocation: boolean;
  excludeAllDayEvents: boolean;
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
  customEventName: string;
}

const toResolvedFeed = (row: FeedRow): ResolvedFeed => ({
  feedId: row.feedId,
  userId: row.userId,
  legacyAlias: row.legacyAlias,
  settings: {
    includeEventName: row.includeEventName,
    includeEventDescription: row.includeEventDescription,
    includeEventLocation: row.includeEventLocation,
    excludeAllDayEvents: row.excludeAllDayEvents,
    excludeFocusTime: row.excludeFocusTime,
    excludeOutOfOffice: row.excludeOutOfOffice,
    customEventName: row.customEventName,
  },
});

/*
 * A token names a feed directly. A bare user identifier is the pre-migration
 * URL shape, which keeps resolving to that account's backfilled default feed so
 * existing subscriptions do not break.
 */
const resolveFeedIdentifier = async (
  identifier: string,
  dependencies: ResolveFeedIdentifierDependencies,
): Promise<ResolvedFeed | null> => {
  const feedByToken = await dependencies.findFeedByToken(identifier);
  if (feedByToken) {
    return feedByToken;
  }

  const userId = await dependencies.resolveUserIdentifier(identifier);
  if (!userId) {
    return null;
  }

  return await dependencies.findLegacyDefaultFeed(userId);
};

const findFeedByToken = async (
  client: FeedDatabaseClient,
  token: string,
): Promise<ResolvedFeed | null> => {
  const [row] = await client
    .select(FEED_COLUMNS)
    .from(icalFeedsTable)
    .where(eq(icalFeedsTable.token, token))
    .limit(FIRST_RESULT_LIMIT);

  if (!row) {
    return null;
  }
  return toResolvedFeed(row);
};

const findLegacyDefaultFeed = async (
  client: FeedDatabaseClient,
  userId: string,
): Promise<ResolvedFeed | null> => {
  const [row] = await client
    .select(FEED_COLUMNS)
    .from(icalFeedsTable)
    .where(
      and(
        eq(icalFeedsTable.userId, userId),
        eq(icalFeedsTable.isDefault, true),
        eq(icalFeedsTable.legacyAlias, true),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (!row) {
    return null;
  }
  return toResolvedFeed(row);
};

/*
 * The horizon follows the feed's own calendars, so the selection is read with
 * the ranges that bound it rather than the ids alone.
 */
const buildFeedCalendarsQuery = (
  client: FeedDatabaseClient,
  feed: FeedCalendarScope,
) =>
  client
    .select({
      id: calendarsTable.id,
      syncFutureRange: calendarsTable.syncFutureRange,
      syncHistoricRange: calendarsTable.syncHistoricRange,
    })
    .from(icalFeedCalendarsTable)
    .innerJoin(calendarsTable, eq(icalFeedCalendarsTable.calendarId, calendarsTable.id))
    .where(
      and(
        eq(icalFeedCalendarsTable.feedId, feed.feedId),
        eq(calendarsTable.userId, feed.userId),
      ),
    );

const buildFeedWindowFilter = (calendarIds: string[], query: IcalFeedQuery): SQL | undefined => and(
  inArray(eventStatesTable.calendarId, calendarIds),
  lte(eventStatesTable.startTime, query.windowEnd),
  or(
    gte(eventStatesTable.endTime, query.windowStart),
    isNotNull(eventStatesTable.recurrenceRule),
  ),
);

/*
 * The revision digest and the event read share this filter deliberately. If the
 * two ever selected different rows the digest would stop tracking the body, and
 * a subscriber would be handed a 304 for a feed that had in fact changed.
 */
const buildFeedEventFilter = (calendarIds: string[], query: IcalFeedQuery): SQL | undefined => and(
  buildFeedWindowFilter(calendarIds, query),
  or(
    isNull(eventStatesTable.sourceEventType),
    ne(eventStatesTable.sourceEventType, "workingLocation"),
  ),
  or(
    isNull(eventStatesTable.availability),
    ne(eventStatesTable.availability, "workingElsewhere"),
  ),
);

/*
 * Counts the in-window rows the filter above keeps out of the feed, one bucket
 * per reason, so a row excluded by both predicates is counted once.
 */
const readFeedExclusions = async (
  client: FeedDatabaseClient,
  calendarIds: string[],
  query: IcalFeedQuery,
): Promise<FeedExclusionCounts> => {
  const [row] = await client
    .select({
      workingElsewhere: sql<number>`count(*) filter (where
        ${eventStatesTable.availability} = 'workingElsewhere'
        and (${eventStatesTable.sourceEventType} is null
          or ${eventStatesTable.sourceEventType} <> 'workingLocation')
      )`.mapWith(Number),
      workingLocation: sql<number>`count(*) filter (where
        ${eventStatesTable.sourceEventType} = 'workingLocation'
      )`.mapWith(Number),
    })
    .from(eventStatesTable)
    .where(buildFeedWindowFilter(calendarIds, query));

  if (!row) {
    throw new Error("Feed exclusion count aggregate returned no row");
  }

  return row;
};

const buildFeedEventQuery = (
  client: FeedDatabaseClient,
  calendarIds: string[],
  query: IcalFeedQuery,
) =>
  client
    .select({
      calendarId: eventStatesTable.calendarId,
      id: eventStatesTable.id,
      title: eventStatesTable.title,
      description: eventStatesTable.description,
      location: eventStatesTable.location,
      startTime: eventStatesTable.startTime,
      endTime: eventStatesTable.endTime,
      availability: eventStatesTable.availability,
      startTimeZone: eventStatesTable.startTimeZone,
      isAllDay: eventStatesTable.isAllDay,
      recurrenceRule: eventStatesTable.recurrenceRule,
      exceptionDates: eventStatesTable.exceptionDates,
      recurrenceId: eventStatesTable.recurrenceId,
      sourceEventUid: eventStatesTable.sourceEventUid,
      sourceEventType: eventStatesTable.sourceEventType,
      calendarName: calendarsTable.name,
    })
    .from(eventStatesTable)
    .innerJoin(calendarsTable, eq(eventStatesTable.calendarId, calendarsTable.id))
    .where(buildFeedEventFilter(calendarIds, query))
    .orderBy(asc(eventStatesTable.startTime));

/*
 * Every column that reaches the rendered feed is folded in, each coalesced to a
 * concrete string so a null can never shift one field's value into another's
 * position. Postgres does the hashing so an unchanged feed costs one aggregate
 * rather than reading every row into the process and serialising it.
 */
const FEED_REVISION_COLUMNS = [
  eventStatesTable.id,
  eventStatesTable.title,
  eventStatesTable.description,
  eventStatesTable.location,
  eventStatesTable.startTime,
  eventStatesTable.endTime,
  eventStatesTable.availability,
  eventStatesTable.startTimeZone,
  eventStatesTable.isAllDay,
  eventStatesTable.recurrenceRule,
  eventStatesTable.exceptionDates,
  eventStatesTable.recurrenceId,
  eventStatesTable.sourceEventUid,
  eventStatesTable.sourceEventType,
  calendarsTable.name,
];

const readFeedRevision = async (
  client: FeedDatabaseClient,
  calendarIds: string[],
  query: IcalFeedQuery,
): Promise<string> => {
  const fields = sql.join(
    FEED_REVISION_COLUMNS.map((column) => sql`coalesce(${column}::text, '')`),
    sql`, `,
  );

  const [row] = await client
    .select({
      revision: sql<string>`encode(sha256(convert_to(coalesce(string_agg(
        concat_ws(chr(31), ${fields}), chr(30) order by ${eventStatesTable.id}
      ), ''), 'UTF8')), 'hex')`,
    })
    .from(eventStatesTable)
    .innerJoin(calendarsTable, eq(eventStatesTable.calendarId, calendarsTable.id))
    .where(buildFeedEventFilter(calendarIds, query));

  return row?.revision ?? "";
};

/*
 * The context and user modules are pulled in on demand so the query builders
 * above stay importable without booting the service environment.
 */
const generateUserCalendar = async (
  identifier: string,
  ifNoneMatch: string | null,
): Promise<FeedResponse | null> => {
  const { database } = await import("@/context");
  const { resolveUserIdentifier } = await import("./user");

  return await generateCalendarFeed<FeedCalendarScope>(identifier, {
    resolveFeed: async (token) => {
      const feed = await resolveFeedIdentifier(token, {
        findFeedByToken: (candidate) => findFeedByToken(database, candidate),
        resolveUserIdentifier,
        findLegacyDefaultFeed: (userId) => findLegacyDefaultFeed(database, userId),
      });

      if (!feed) {
        return null;
      }

      widelog.set("feed.id", feed.feedId);
      widelog.set("feed.legacy_identifier", feed.legacyAlias);

      return {
        scope: { feedId: feed.feedId, userId: feed.userId },
        settings: feed.settings,
      };
    },
    readFeedCalendars: async (scope) => {
      const calendars = await buildFeedCalendarsQuery(database, scope);
      widelog.set("feed.calendar_count", calendars.length);
      return calendars;
    },
    readFeedEvents: (calendarIds, query) =>
      buildFeedEventQuery(database, calendarIds, query),
    readFeedExclusions: (calendarIds, query) =>
      readFeedExclusions(database, calendarIds, query),
    readFeedRevision: (calendarIds, query) =>
      readFeedRevision(database, calendarIds, query),
  }, ifNoneMatch);
};

export {
  buildFeedCalendarsQuery,
  buildFeedEventQuery,
  findFeedByToken,
  findLegacyDefaultFeed,
  generateUserCalendar,
  resolveFeedIdentifier,
};
export type { FeedCalendarScope, ResolveFeedIdentifierDependencies, ResolvedFeed };
