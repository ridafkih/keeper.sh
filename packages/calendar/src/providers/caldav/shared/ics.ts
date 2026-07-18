import { generateIcsCalendar } from "ts-ics";
import {
  applyCalendarTimeZoneToFloatingEventDates,
  buildZonedIcsDate,
  normalizeTimezone,
  parseIcsCalendar,
  parseIcsEvents,
} from "../../../ics";
import type {
  IcsCalendar,
  IcsEvent,
  IcsExceptionDates,
  IcsRecurrenceRule,
} from "ts-ics";
import type { MaterializedSyncableEvent, SyncableEvent } from "../../../core/types";
import { isKeeperEvent } from "../../../core/events/identity";
import { resolveIsAllDayEvent } from "../../../core/events/all-day";
import {
  assertNoUnsupportedRecurrenceDates,
  assertSupportedRecurrenceTimeZones,
} from "../../../ics/utils/validate-recurrence-input";

const normalizeIcsText = (value: string | undefined): string | undefined =>
  value?.replaceAll(/\r\n?/g, "\n");

const eventToICalString = (event: MaterializedSyncableEvent, uid: string): string => {
  const isAllDay = resolveIsAllDayEvent(event);
  const icsEvent: IcsEvent = {
    description: normalizeIcsText(event.description),
    end: buildZonedIcsDate(event.endTime, event.startTimeZone, isAllDay),
    location: normalizeIcsText(event.location),
    stamp: { date: new Date() },
    start: buildZonedIcsDate(event.startTime, event.startTimeZone, isAllDay),
    summary: event.summary.replaceAll(/\r\n?/g, "\n"),
    ...(event.availability === "free" && { timeTransparent: "TRANSPARENT" }),
    uid,
  };

  const calendar: IcsCalendar = {
    events: [icsEvent],
    prodId: "-//Keeper//Keeper Calendar//EN",
    version: "2.0",
  };

  return generateIcsCalendar(calendar);
};

interface ParsedCalendarEvent {
  availability?: SyncableEvent["availability"];
  deleteId: string;
  endTime: Date;
  isKeeperEvent: boolean;
  isAllDay?: boolean;
  startTime: Date;
  uid: string;
  title?: string;
  description?: string;
  location?: string;
  startTimeZone?: string;
  recurrenceRule?: IcsRecurrenceRule;
  recurrenceDuration?: SyncableEvent["recurrenceDuration"];
  exceptionDates?: IcsExceptionDates;
  recurrenceId?: Date;
}

interface ParseICalCalendarsOptions {
  rejectUnsupportedRecurrenceDates?: boolean;
}

const parseICalCalendarsToRemoteEvents = (
  icsStrings: string[],
  options: ParseICalCalendarsOptions = {},
): ParsedCalendarEvent[] => {
  const calendars = icsStrings.map((icsString) => {
    if (options.rejectUnsupportedRecurrenceDates !== false) {
      assertNoUnsupportedRecurrenceDates(icsString);
    }
    const initialCalendar = parseIcsCalendar({ icsString });
    const normalizedIcs = applyCalendarTimeZoneToFloatingEventDates(
      icsString,
      normalizeTimezone(initialCalendar.nonStandard?.wrTimezone),
    );
    if (normalizedIcs === icsString) {
      return initialCalendar;
    }
    return parseIcsCalendar({ icsString: normalizedIcs });
  });
  const [firstCalendar] = calendars;
  if (!firstCalendar) {
    return [];
  }
  const calendar = {
    ...firstCalendar,
    events: calendars.flatMap((entry) => entry.events ?? []),
  };
  const events = parseIcsEvents(calendar, { includeKeeperEvents: true });
  assertSupportedRecurrenceTimeZones(events);
  return events.map((event) => ({
    availability: event.availability ?? "busy",
    deleteId: event.uid,
    description: event.description,
    endTime: event.endTime,
    exceptionDates: event.exceptionDates,
    recurrenceId: event.recurrenceId,
    isKeeperEvent: isKeeperEvent(event.uid),
    isAllDay: event.isAllDay,
    location: event.location,
    recurrenceDuration: event.recurrenceDuration,
    recurrenceRule: event.recurrenceRule,
    startTime: event.startTime,
    startTimeZone: event.startTimeZone,
    title: event.title,
    uid: event.uid,
  }));
};

const parseICalToRemoteEvents = (icsString: string): ParsedCalendarEvent[] =>
  parseICalCalendarsToRemoteEvents([icsString]);

const parseICalToRemoteEvent = (icsString: string): ParsedCalendarEvent | null => {
  const [event] = parseICalToRemoteEvents(icsString);
  return event ?? null;
};

export {
  eventToICalString,
  parseICalCalendarsToRemoteEvents,
  parseICalToRemoteEvent,
  parseICalToRemoteEvents,
};
export type { ParseICalCalendarsOptions };
