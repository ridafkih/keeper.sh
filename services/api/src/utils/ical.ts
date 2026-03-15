import { calendarsTable, eventStatesTable, icalFeedSettingsTable } from "@keeper.sh/database/schema";
import { KEEPER_EVENT_SUFFIX } from "@keeper.sh/constants";
import { generateIcsCalendar } from "ts-ics";
import type { IcsCalendar, IcsEvent } from "ts-ics";
import { and, asc, eq, inArray } from "drizzle-orm";
import { resolveUserIdentifier } from "./user";
import { database } from "../context";

interface FeedSettings {
  includeEventName: boolean;
  includeEventDescription: boolean;
  includeEventLocation: boolean;
  excludeAllDayEvents: boolean;
  customEventName: string;
}

const DEFAULT_FEED_SETTINGS: FeedSettings = {
  includeEventName: false,
  includeEventDescription: false,
  includeEventLocation: false,
  excludeAllDayEvents: false,
  customEventName: "Busy",
};

interface CalendarEvent {
  id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  startTime: Date;
  endTime: Date;
  calendarName: string;
}

const isAllDayEvent = (event: CalendarEvent): boolean => {
  const durationMs = event.endTime.getTime() - event.startTime.getTime();
  const hours = durationMs / (1000 * 60 * 60);
  return hours >= 24 && event.startTime.getHours() === 0 && event.endTime.getHours() === 0;
};

const resolveTemplate = (template: string, variables: Record<string, string>): string =>
  template.replaceAll(/\{\{(\w+)\}\}/g, (match, name) => variables[name] ?? match);

const resolveEventSummary = (event: CalendarEvent, settings: FeedSettings): string => {
  let template = settings.customEventName;
  if (settings.includeEventName) {
    template = event.title || settings.customEventName;
  }

  return resolveTemplate(template, {
    event_name: event.title || "Untitled",
    calendar_name: event.calendarName,
  });
};

const formatEventsAsIcal = (events: CalendarEvent[], settings: FeedSettings): string => {
  let filteredEvents = events;
  if (settings.excludeAllDayEvents) {
    filteredEvents = events.filter((event) => !isAllDayEvent(event));
  }

  const icsEvents: IcsEvent[] = filteredEvents.map((event) => {
    const icsEvent: IcsEvent = {
      end: { date: event.endTime },
      stamp: { date: new Date() },
      start: { date: event.startTime },
      summary: resolveEventSummary(event, settings),
      uid: `${event.id}${KEEPER_EVENT_SUFFIX}`,
    };

    if (settings.includeEventDescription && event.description) {
      icsEvent.description = event.description;
    }

    if (settings.includeEventLocation && event.location) {
      icsEvent.location = event.location;
    }

    return icsEvent;
  });

  const calendar: IcsCalendar = {
    events: icsEvents,
    prodId: "-//Keeper//Keeper Calendar//EN",
    version: "2.0",
  };

  return generateIcsCalendar(calendar);
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
      calendarName: calendarsTable.name,
    })
    .from(eventStatesTable)
    .innerJoin(calendarsTable, eq(eventStatesTable.calendarId, calendarsTable.id))
    .where(inArray(eventStatesTable.calendarId, calendarIds))
    .orderBy(asc(eventStatesTable.startTime));

  return formatEventsAsIcal(events, settings);
};

export { generateUserCalendar };
