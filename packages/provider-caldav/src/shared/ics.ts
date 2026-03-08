import { generateIcsCalendar } from "ts-ics";
import { parseIcsCalendar } from "@keeper.sh/calendar";
import type { IcsCalendar, IcsEvent } from "ts-ics";
import type { RemoteEvent, SyncableEvent } from "@keeper.sh/provider-core";
import { isKeeperEvent } from "@keeper.sh/provider-core";

const eventToICalString = (event: SyncableEvent, uid: string): string => {
  const icsEvent: IcsEvent = {
    description: event.description,
    end: { date: event.endTime },
    location: event.location,
    stamp: { date: new Date() },
    start: { date: event.startTime },
    summary: event.summary,
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
  deleteId: string;
  endTime: Date;
  isKeeperEvent: boolean;
  startTime: Date;
  uid: string;
  title?: string;
  description?: string;
  location?: string;
  startTimeZone?: string;
  recurrenceRule?: object;
  exceptionDates?: object;
}

const parseICalToRemoteEvent = (icsString: string): ParsedCalendarEvent | null => {
  const calendar = parseIcsCalendar({ icsString });
  const [event] = calendar.events ?? [];

  if (!event?.uid || !event.start?.date || !event.end?.date) {
    return null;
  }

  return {
    deleteId: event.uid,
    description: event.description,
    endTime: new Date(event.end.date),
    exceptionDates: event.exceptionDates,
    isKeeperEvent: isKeeperEvent(event.uid),
    location: event.location,
    recurrenceRule: event.recurrenceRule,
    startTime: new Date(event.start.date),
    startTimeZone: event.start.local?.timezone,
    title: event.summary,
    uid: event.uid,
  };
};

export { eventToICalString, parseICalToRemoteEvent };
