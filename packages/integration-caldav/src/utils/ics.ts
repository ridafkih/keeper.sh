import {
  generateIcsCalendar,
  convertIcsCalendar,
  type IcsCalendar,
  type IcsEvent,
} from "ts-ics";
import type { SyncableEvent, RemoteEvent } from "@keeper.sh/integration";

export const eventToICalString = (
  event: SyncableEvent,
  uid: string,
): string => {
  const icsEvent: IcsEvent = {
    uid,
    stamp: { date: new Date() },
    start: { date: event.startTime },
    end: { date: event.endTime },
    summary: event.summary,
    description: event.description,
  };

  const calendar: IcsCalendar = {
    version: "2.0",
    prodId: "-//Keeper//Keeper Calendar//EN",
    events: [icsEvent],
  };

  return generateIcsCalendar(calendar);
};

export const parseICalToRemoteEvent = (
  icsString: string,
): RemoteEvent | null => {
  const calendar = convertIcsCalendar(undefined, icsString);
  const [event] = calendar.events ?? [];

  if (!event?.uid || !event.start?.date || !event.end?.date) {
    return null;
  }

  return {
    uid: event.uid,
    deleteId: event.uid,
    startTime: new Date(event.start.date),
    endTime: new Date(event.end.date),
  };
};
