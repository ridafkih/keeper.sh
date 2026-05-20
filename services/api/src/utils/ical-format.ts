import { KEEPER_EVENT_SUFFIX } from "@keeper.sh/constants";
import { resolveIsAllDayEvent } from "@keeper.sh/calendar";
import { generateIcsCalendar } from "ts-ics";
import type { IcsCalendar, IcsDateObject, IcsEvent, IcsRecurrenceRule } from "ts-ics";

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
  recurrenceRule: IcsRecurrenceRule | null;
  exceptionDates: IcsDateObject[] | null;
  recurrenceId: Date | null;
  sourceEventUid: string | null;
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

/**
 * Group rows by sourceEventUid so we can emit a recurring master with its
 * modified-occurrence overrides under a single UID. Within a group, the master
 * is the row with `recurrenceRule != null` and `recurrenceId == null`; the rest
 * are overrides that need `RECURRENCE-ID` linking back to the master.
 *
 * Returns groups with the master at index 0 (or the only/first row if there is
 * no clear master). Events without a sourceEventUid can't be reliably linked
 * and are returned as singleton groups.
 */
const groupRecurringEvents = (events: CalendarEvent[]): CalendarEvent[][] => {
  const groups = new Map<string, CalendarEvent[]>();
  const singletons: CalendarEvent[][] = [];

  for (const event of events) {
    if (!event.sourceEventUid) {
      singletons.push([event]);
      continue;
    }
    const existing = groups.get(event.sourceEventUid);
    if (existing) {
      existing.push(event);
    } else {
      groups.set(event.sourceEventUid, [event]);
    }
  }

  const result: CalendarEvent[][] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group);
      continue;
    }
    const masterIdx = group.findIndex((e) => e.recurrenceRule !== null && e.recurrenceId === null);
    if (masterIdx > 0) {
      const [master] = group.splice(masterIdx, 1);
      group.unshift(master);
    }
    result.push(group);
  }
  return [...result, ...singletons];
};

const buildBaseIcsEvent = (event: CalendarEvent, uid: string, settings: FeedSettings): IcsEvent => {
  const isAllDay = resolveIsAllDayEvent(toAllDayShape(event));
  const icsEvent: IcsEvent = {
    end: { date: event.endTime, ...(isAllDay && { type: "DATE" as const }) },
    stamp: { date: new Date() },
    start: { date: event.startTime, ...(isAllDay && { type: "DATE" as const }) },
    summary: resolveEventSummary(event, settings),
    uid,
  };

  if (settings.includeEventDescription && event.description) {
    icsEvent.description = event.description;
  }

  if (settings.includeEventLocation && event.location) {
    icsEvent.location = event.location;
  }

  return icsEvent;
};

const formatEventsAsIcal = (events: CalendarEvent[], settings: FeedSettings): string => {
  const filteredEvents = events.filter((event) => {
    if (!settings.excludeAllDayEvents) {
      return true;
    }
    return !resolveIsAllDayEvent(toAllDayShape(event));
  });

  const icsEvents: IcsEvent[] = [];

  for (const group of groupRecurringEvents(filteredEvents)) {
    const master = group[0]!;
    const uid = `${master.id}${KEEPER_EVENT_SUFFIX}`;

    for (const event of group) {
      // Overrides reuse the master's UID; the master uses its own.
      const ics = buildBaseIcsEvent(event, uid, settings);

      if (event !== master && event.recurrenceId) {
        // ts-ics IcsRecurrenceId shape: { value: { date: Date } }.
        ics.recurrenceId = { value: { date: event.recurrenceId } };
      }

      // RRULE + EXDATE only belong on the master itself, not on overrides.
      if (event.recurrenceRule && !event.recurrenceId) {
        ics.recurrenceRule = event.recurrenceRule;
      }
      if (event.exceptionDates && event.exceptionDates.length > 0 && !event.recurrenceId) {
        ics.exceptionDates = event.exceptionDates;
      }

      icsEvents.push(ics);
    }
  }

  const calendar: IcsCalendar = {
    events: icsEvents,
    prodId: "-//Keeper//Keeper Calendar//EN",
    version: "2.0",
  };

  return generateIcsCalendar(calendar);
};

export { formatEventsAsIcal };
export type { CalendarEvent, FeedSettings };
