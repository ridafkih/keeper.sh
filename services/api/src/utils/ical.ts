import { calendarsTable, eventStatesTable, icalFeedSettingsTable } from "@keeper.sh/database/schema";
import { and, asc, eq, gte, inArray, isNotNull, lte, ne, or, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { resolveUserIdentifier } from "./user";
import { database } from "@/context";
import { generateCalendarFeed } from "./ical-feed";
import type { FeedResponse, IcalFeedQuery, StoredFeedEvent } from "./ical-feed";
import type { FeedSettings } from "./ical-format";

const FIRST_RESULT_LIMIT = 1;

const readFeedSettings = async (userId: string): Promise<FeedSettings | null> => {
  const [settings] = await database
    .select()
    .from(icalFeedSettingsTable)
    .where(eq(icalFeedSettingsTable.userId, userId))
    .limit(FIRST_RESULT_LIMIT);

  return settings ?? null;
};

const readFeedCalendars = async (userId: string) => {
  const calendars = await database
    .select({
      id: calendarsTable.id,
      syncFutureRange: calendarsTable.syncFutureRange,
      syncHistoricRange: calendarsTable.syncHistoricRange,
    })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.userId, userId),
        eq(calendarsTable.includeInIcalFeed, true),
      ),
    );

  return calendars;
};

/*
 * The revision digest and the event read share this filter deliberately. If the
 * two ever selected different rows the digest would stop tracking the body, and
 * a subscriber would be handed a 304 for a feed that had in fact changed.
 */
const buildFeedEventFilter = (calendarIds: string[], query: IcalFeedQuery): SQL | undefined => and(
  inArray(eventStatesTable.calendarId, calendarIds),
  or(
    isNull(eventStatesTable.sourceEventType),
    ne(eventStatesTable.sourceEventType, "workingLocation"),
  ),
  or(
    isNull(eventStatesTable.availability),
    ne(eventStatesTable.availability, "workingElsewhere"),
  ),
  lte(eventStatesTable.startTime, query.windowEnd),
  or(
    gte(eventStatesTable.endTime, query.windowStart),
    isNotNull(eventStatesTable.recurrenceRule),
  ),
);

const readFeedEvents = (
  calendarIds: string[],
  query: IcalFeedQuery,
): Promise<StoredFeedEvent[]> => database
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
  calendarsTable.name,
];

const readFeedRevision = async (
  calendarIds: string[],
  query: IcalFeedQuery,
): Promise<string> => {
  const fields = sql.join(
    FEED_REVISION_COLUMNS.map((column) => sql`coalesce(${column}::text, '')`),
    sql`, `,
  );

  const [row] = await database
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

const generateUserCalendar = (
  identifier: string,
  ifNoneMatch: string | null,
): Promise<FeedResponse | null> =>
  generateCalendarFeed(identifier, {
    readFeedCalendars,
    readFeedEvents,
    readFeedRevision,
    readFeedSettings,
    resolveUserIdentifier,
  }, ifNoneMatch);

export { generateUserCalendar };
