import { KEEPER_EVENT_SUFFIX } from "@keeper.sh/constants";
import { resolveIsAllDayEvent } from "@keeper.sh/calendar";
import { generateIcsCalendar } from "ts-ics";
import type { IcsCalendar, IcsEvent } from "ts-ics";

interface FeedSettings {
  includeEventName: boolean;
  includeEventDescription: boolean;
  includeEventLocation: boolean;
  excludeAllDayEvents: boolean;
  customEventName: string;
}

interface CalendarEvent {
  id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean | null;
  calendarName: string;
}

const toAllDayShape = (event: CalendarEvent) => ({
  startTime: event.startTime,
  endTime: event.endTime,
  ...(event.isAllDay !== null && { isAllDay: event.isAllDay }),
});

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
  const filteredEvents = events.filter((event) => {
    if (!settings.excludeAllDayEvents) {
      return true;
    }
    return !resolveIsAllDayEvent(toAllDayShape(event));
  });

  const icsEvents: IcsEvent[] = filteredEvents.map((event) => {
    const isAllDay = resolveIsAllDayEvent(toAllDayShape(event));
    const icsEvent: IcsEvent = {
      end: { date: event.endTime, ...(isAllDay && { type: "DATE" as const }) },
      stamp: { date: new Date() },
      start: { date: event.startTime, ...(isAllDay && { type: "DATE" as const }) },
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

export { formatEventsAsIcal };
export type { CalendarEvent, FeedSettings };
