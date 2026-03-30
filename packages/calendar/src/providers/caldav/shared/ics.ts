import { generateIcsCalendar } from "ts-ics";
import { parseIcsCalendar } from "../../../ics";
import type { IcsCalendar, IcsDuration, IcsEvent } from "ts-ics";
import type { SyncableEvent } from "../../../core/types";
import { isKeeperEvent } from "../../../core/events/identity";
import { resolveIsAllDayEvent } from "../../../core/events/all-day";
import {
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  MS_PER_WEEK,
} from "@keeper.sh/constants";

const DEFAULT_DURATION_VALUE = 0;

const durationToMs = (duration: IcsDuration): number => {
  const {
    weeks = DEFAULT_DURATION_VALUE,
    days = DEFAULT_DURATION_VALUE,
    hours = DEFAULT_DURATION_VALUE,
    minutes = DEFAULT_DURATION_VALUE,
    seconds = DEFAULT_DURATION_VALUE,
  } = duration;

  return (
    weeks * MS_PER_WEEK
    + days * MS_PER_DAY
    + hours * MS_PER_HOUR
    + minutes * MS_PER_MINUTE
    + seconds * MS_PER_SECOND
  );
};

const getEventEndTime = (event: IcsEvent, startTime: Date): Date => {
  if ("end" in event && event.end) {
    return event.end.date;
  }

  if ("duration" in event && event.duration) {
    return new Date(startTime.getTime() + durationToMs(event.duration));
  }

  return startTime;
};

const eventToICalString = (event: SyncableEvent, uid: string): string => {
  const isAllDay = resolveIsAllDayEvent(event);
  const icsEvent: IcsEvent = {
    description: event.description,
    end: { date: event.endTime, ...(isAllDay && { type: "DATE" }) },
    location: event.location,
    stamp: { date: new Date() },
    start: { date: event.startTime, ...(isAllDay && { type: "DATE" }) },
    summary: event.summary,
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
  recurrenceRule?: object;
  exceptionDates?: object;
}

const mapAvailability = (transparency: "TRANSPARENT" | "OPAQUE" | undefined) => {
  if (transparency === "TRANSPARENT") {
    return "free";
  }
  return "busy";
};

const mapIcsEventToParsedEvent = (event: IcsEvent): ParsedCalendarEvent | null => {
  if (!event.uid || !event.start?.date) {
    return null;
  }

  const startTime = event.start.date;
  const endTime = getEventEndTime(event, startTime);

  return {
    availability: mapAvailability(event.timeTransparent),
    deleteId: event.uid,
    description: event.description,
    endTime,
    exceptionDates: event.exceptionDates,
    isKeeperEvent: isKeeperEvent(event.uid),
    isAllDay: event.start.type === "DATE",
    location: event.location,
    recurrenceRule: event.recurrenceRule,
    startTime,
    startTimeZone: event.start.local?.timezone,
    title: event.summary,
    uid: event.uid,
  };
};

const parseICalToRemoteEvents = (icsString: string): ParsedCalendarEvent[] => {
  const calendar = parseIcsCalendar({ icsString });
  const events = calendar.events ?? [];
  const parsed: ParsedCalendarEvent[] = [];

  for (const event of events) {
    const result = mapIcsEventToParsedEvent(event);
    if (result) {
      parsed.push(result);
    }
  }

  return parsed;
};

const parseICalToRemoteEvent = (icsString: string): ParsedCalendarEvent | null => {
  const [event] = parseICalToRemoteEvents(icsString);
  return event ?? null;
};

export { eventToICalString, parseICalToRemoteEvent, parseICalToRemoteEvents };
