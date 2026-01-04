import {
  remoteICalSourcesTable,
  eventStatesTable,
} from "@keeper.sh/database/schema";
import { KEEPER_EVENT_SUFFIX } from "@keeper.sh/constants";
import { generateIcsCalendar, type IcsCalendar, type IcsEvent } from "ts-ics";
import { eq, inArray, asc } from "drizzle-orm";
import { resolveUserIdentifier } from "./user";
import { database } from "../context";

interface CalendarEvent {
  id: string;
  startTime: Date;
  endTime: Date;
}

/**
 * Formats events as an iCal string.
 */
export const formatEventsAsIcal = (events: CalendarEvent[]): string => {
  const icsEvents: IcsEvent[] = events.map((event) => ({
    uid: `${event.id}${KEEPER_EVENT_SUFFIX}`,
    stamp: { date: new Date() },
    start: { date: event.startTime },
    end: { date: event.endTime },
    summary: "Busy",
  }));

  const calendar: IcsCalendar = {
    version: "2.0",
    prodId: "-//Keeper//Keeper Calendar//EN",
    events: icsEvents,
  };

  return generateIcsCalendar(calendar);
};

/**
 * Generates an iCal calendar for a user by their identifier.
 * Returns null if user not found.
 */
export const generateUserCalendar = async (
  identifier: string,
): Promise<string | null> => {
  const userId = await resolveUserIdentifier(identifier);

  if (!userId) {
    return null;
  }

  const sources = await database
    .select({ id: remoteICalSourcesTable.id })
    .from(remoteICalSourcesTable)
    .where(eq(remoteICalSourcesTable.userId, userId));

  if (sources.length === 0) {
    return formatEventsAsIcal([]);
  }

  const sourceIds = sources.map(({ id }) => id);
  const events = await database
    .select({
      id: eventStatesTable.id,
      startTime: eventStatesTable.startTime,
      endTime: eventStatesTable.endTime,
    })
    .from(eventStatesTable)
    .where(inArray(eventStatesTable.sourceId, sourceIds))
    .orderBy(asc(eventStatesTable.startTime));

  return formatEventsAsIcal(events);
};
