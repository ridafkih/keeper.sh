import { calendarsTable, eventStatesTable, icalFeedSettingsTable } from "@keeper.sh/database/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { resolveUserIdentifier } from "./user";
import { database } from "@/context";
import { formatEventsAsIcal } from "./ical-format";
import type { FeedSettings } from "./ical-format";

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
  const events = await database
    .select({
      id: eventStatesTable.id,
      title: eventStatesTable.title,
      description: eventStatesTable.description,
      location: eventStatesTable.location,
      startTime: eventStatesTable.startTime,
      endTime: eventStatesTable.endTime,
      isAllDay: eventStatesTable.isAllDay,
      calendarName: calendarsTable.name,
    })
    .from(eventStatesTable)
    .innerJoin(calendarsTable, eq(eventStatesTable.calendarId, calendarsTable.id))
    .where(inArray(eventStatesTable.calendarId, calendarIds))
    .orderBy(asc(eventStatesTable.startTime));

  return formatEventsAsIcal(events, settings);
};

export { generateUserCalendar };
