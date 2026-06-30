import { calendarsTable, eventStatesTable, icalFeedSettingsTable } from "@keeper.sh/database/schema";
import { icsExceptionDatesSchema, icsRecurrenceRuleSchema } from "@keeper.sh/data-schemas";
import { and, asc, eq, inArray, ne, or, isNull } from "drizzle-orm";
import { type } from "arktype";
import { resolveUserIdentifier } from "./user";
import { database } from "@/context";
import { formatEventsAsIcal } from "./ical-format";
import type { CalendarEvent, FeedSettings } from "./ical-format";

const parseStoredJson = (value: string, field: string, eventId: string): unknown => {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Failed to JSON.parse ${field} for event ${eventId}`, { cause: error });
  }
};

const parseRecurrenceRule = (value: string | null, eventId: string) => {
  if (value === null) {
    return null;
  }
  const parsed = parseStoredJson(value, "recurrenceRule", eventId);
  const result = icsRecurrenceRuleSchema(parsed);
  if (result instanceof type.errors) {
    throw new TypeError(`Invalid recurrenceRule shape for event ${eventId}: ${result.summary}`);
  }
  return result;
};

const parseExceptionDates = (value: string | null, eventId: string) => {
  if (value === null) {
    return null;
  }
  const parsed = parseStoredJson(value, "exceptionDates", eventId);
  const result = icsExceptionDatesSchema(parsed);
  if (result instanceof type.errors) {
    throw new TypeError(`Invalid exceptionDates shape for event ${eventId}: ${result.summary}`);
  }
  return result;
};

const DEFAULT_FEED_SETTINGS: FeedSettings = {
  includeEventName: false,
  includeEventDescription: false,
  includeEventLocation: false,
  excludeAllDayEvents: false,
  customEventName: "Busy",
};

const getFeedSettings = async (userId: string): Promise<FeedSettings> => {
  const [settings] = await database
    .select()
    .from(icalFeedSettingsTable)
    .where(eq(icalFeedSettingsTable.userId, userId))
    .limit(1);

  return settings ?? DEFAULT_FEED_SETTINGS;
};

const generateUserCalendar = async (identifier: string): Promise<string | null> => {
  const userId = await resolveUserIdentifier(identifier);

  if (!userId) {
    return null;
  }

  const [settings, sources] = await Promise.all([
    getFeedSettings(userId),
    database
      .select({ id: calendarsTable.id })
      .from(calendarsTable)
      .where(
        and(
          eq(calendarsTable.userId, userId),
          eq(calendarsTable.includeInIcalFeed, true),
        ),
      ),
  ]);

  if (sources.length === 0) {
    return formatEventsAsIcal([], settings);
  }

  const calendarIds = sources.map(({ id }) => id);
  const rows = await database
    .select({
      id: eventStatesTable.id,
      title: eventStatesTable.title,
      description: eventStatesTable.description,
      location: eventStatesTable.location,
      startTime: eventStatesTable.startTime,
      endTime: eventStatesTable.endTime,
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
    .where(
      and(
        inArray(eventStatesTable.calendarId, calendarIds),
        or(
          isNull(eventStatesTable.sourceEventType),
          ne(eventStatesTable.sourceEventType, "workingLocation"),
        ),
        or(
          isNull(eventStatesTable.availability),
          ne(eventStatesTable.availability, "workingElsewhere"),
        ),
      ),
    )
    .orderBy(asc(eventStatesTable.startTime));

  const events: CalendarEvent[] = rows.map((row) => ({
    ...row,
    recurrenceRule: parseRecurrenceRule(row.recurrenceRule, row.id),
    exceptionDates: parseExceptionDates(row.exceptionDates, row.id),
  }));

  return formatEventsAsIcal(events, settings);
};

export { generateUserCalendar };
