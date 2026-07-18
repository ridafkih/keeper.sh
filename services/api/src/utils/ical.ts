import { calendarsTable, eventStatesTable, icalFeedSettingsTable } from "@keeper.sh/database/schema";
import {
  parseStoredIcsExceptionDates,
  parseStoredIcsRecurrence,
} from "@keeper.sh/calendar";
import { and, asc, eq, inArray, ne, or, isNull } from "drizzle-orm";
import { resolveUserIdentifier } from "./user";
import { database } from "@/context";
import { formatEventsAsIcal } from "./ical-format";
import type { CalendarEvent, FeedSettings } from "./ical-format";

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

  const events: CalendarEvent[] = rows.map((row) => {
    const recurrence = parseStoredIcsRecurrence(row.recurrenceRule, row.id);
    return {
      ...row,
      recurrenceDuration: recurrence?.recurrenceDuration ?? null,
      recurrenceRule: recurrence?.recurrenceRule ?? null,
      exceptionDates: parseStoredIcsExceptionDates(row.exceptionDates, row.id),
    };
  });

  return formatEventsAsIcal(events, settings);
};

export { generateUserCalendar };
