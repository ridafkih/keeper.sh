import { generateIcsCalendar } from "ts-ics";
import { parseIcsCalendar } from "@keeper.sh/calendar";
import type { IcsCalendar, IcsEvent } from "ts-ics";
import type { RemoteEvent, SyncableEvent } from "@keeper.sh/integration";

const eventToICalString = (event: SyncableEvent, uid: string): string => {
  const icsEvent: IcsEvent = {
    description: event.description,
    end: { date: event.endTime },
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

const parseICalToRemoteEvent = (icsString: string): RemoteEvent | null => {
  const calendar = parseIcsCalendar({ icsString });
  const [event] = calendar.events ?? [];

  if (!event?.uid || !event.start?.date || !event.end?.date) {
    return null;
  }

  return {
    deleteId: event.uid,
    endTime: new Date(event.end.date),
    startTime: new Date(event.start.date),
    uid: event.uid,
  };
};

export { eventToICalString, parseICalToRemoteEvent };
