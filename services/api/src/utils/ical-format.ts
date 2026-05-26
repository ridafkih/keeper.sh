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

interface EventGroup {
  master: CalendarEvent;
  overrides: CalendarEvent[];
}

const isRecurringMaster = (event: CalendarEvent): boolean =>
  event.recurrenceRule !== null && event.recurrenceId === null;

const groupEventsBySourceUid = (events: CalendarEvent[]): EventGroup[] => {
  const groups = new Map<string, EventGroup>();
  const ungrouped: EventGroup[] = [];

  for (const event of events) {
    if (!event.sourceEventUid) {
      ungrouped.push({ master: event, overrides: [] });
      continue;
    }
    const existing = groups.get(event.sourceEventUid);
    if (!existing) {
      groups.set(event.sourceEventUid, { master: event, overrides: [] });
      continue;
    }
    if (isRecurringMaster(event) && !isRecurringMaster(existing.master)) {
      existing.overrides.push(existing.master);
      existing.master = event;
    } else {
      existing.overrides.push(event);
    }
  }

  return [...groups.values(), ...ungrouped];
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

const applyMasterRecurrence = (ics: IcsEvent, master: CalendarEvent): IcsEvent => {
  if (master.recurrenceRule) {
    ics.recurrenceRule = master.recurrenceRule;
  }
  if (master.exceptionDates && master.exceptionDates.length > 0) {
    ics.exceptionDates = master.exceptionDates;
  }
  return ics;
};

const applyOverrideRecurrence = (ics: IcsEvent, override: CalendarEvent): IcsEvent => {
  if (override.recurrenceId) {
    ics.recurrenceId = { value: { date: override.recurrenceId } };
  }
  return ics;
};

const buildIcsEventsForGroup = (group: EventGroup, settings: FeedSettings): IcsEvent[] => {
  const uid = `${group.master.id}${KEEPER_EVENT_SUFFIX}`;
  const master = applyMasterRecurrence(buildBaseIcsEvent(group.master, uid, settings), group.master);
  const overrides = group.overrides.map((override) =>
    applyOverrideRecurrence(buildBaseIcsEvent(override, uid, settings), override),
  );
  return [master, ...overrides];
};

const shouldIncludeEvent = (event: CalendarEvent, settings: FeedSettings): boolean => {
  if (!settings.excludeAllDayEvents) {
    return true;
  }
  return !resolveIsAllDayEvent(toAllDayShape(event));
};

const formatEventsAsIcal = (events: CalendarEvent[], settings: FeedSettings): string => {
  const filteredEvents = events.filter((event) => shouldIncludeEvent(event, settings));
  const groups = groupEventsBySourceUid(filteredEvents);
  const icsEvents = groups.flatMap((group) => buildIcsEventsForGroup(group, settings));

  const calendar: IcsCalendar = {
    events: icsEvents,
    prodId: "-//Keeper//Keeper Calendar//EN",
    version: "2.0",
  };

  return generateIcsCalendar(calendar);
};

export { formatEventsAsIcal };
export type { CalendarEvent, FeedSettings };
