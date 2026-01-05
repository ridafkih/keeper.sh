import { eventStatesTable, remoteICalSourcesTable } from "@keeper.sh/database/schema";
import { KEEPER_EVENT_SUFFIX } from "@keeper.sh/constants";
import { generateIcsCalendar } from "ts-ics";
import type { IcsCalendar, IcsEvent } from "ts-ics";
import { asc, eq, inArray } from "drizzle-orm";
import { resolveUserIdentifier } from "./user";
import { database } from "../context";

const EMPTY_SOURCES_COUNT = 0;

interface CalendarEvent {
  id: string;
  startTime: Date;
  endTime: Date;
}

/**
 * Formats events as an iCal string.
 */
const formatEventsAsIcal = (events: CalendarEvent[]): string => {
  const icsEvents: IcsEvent[] = events.map((event) => ({
    end: { date: event.endTime },
    stamp: { date: new Date() },
    start: { date: event.startTime },
    summary: "Busy",
    uid: `${event.id}${KEEPER_EVENT_SUFFIX}`,
  }));

  const calendar: IcsCalendar = {
    events: icsEvents,
    prodId: "-//Keeper//Keeper Calendar//EN",
    version: "2.0",
  };

  return generateIcsCalendar(calendar);
};

/**
 * Generates an iCal calendar for a user by their identifier.
 * Returns null if user not found.
 */
const generateUserCalendar = async (identifier: string): Promise<string | null> => {
  const userId = await resolveUserIdentifier(identifier);

  if (!userId) {
    return null;
  }

  const sources = await database
    .select({ id: remoteICalSourcesTable.id })
    .from(remoteICalSourcesTable)
    .where(eq(remoteICalSourcesTable.userId, userId));

  if (sources.length === EMPTY_SOURCES_COUNT) {
    return formatEventsAsIcal([]);
  }

  const sourceIds = sources.map(({ id }) => id);
  const events = await database
    .select({
      endTime: eventStatesTable.endTime,
      id: eventStatesTable.id,
      startTime: eventStatesTable.startTime,
    })
    .from(eventStatesTable)
    .where(inArray(eventStatesTable.sourceId, sourceIds))
    .orderBy(asc(eventStatesTable.startTime));

  return formatEventsAsIcal(events);
};

export { formatEventsAsIcal, generateUserCalendar };
