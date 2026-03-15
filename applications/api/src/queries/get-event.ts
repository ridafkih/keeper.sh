import {
  calendarAccountsTable,
  calendarsTable,
  eventStatesTable,
  userEventsTable,
} from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import type { KeeperDatabase, KeeperEvent } from "../types";

const toKeeperEvent = (result: {
  id: string;
  calendarId: string;
  startTime: Date;
  endTime: Date;
  title: string | null;
  description: string | null;
  location: string | null;
  calendarName: string;
  calendarProvider: string;
  calendarUrl: string | null;
}): KeeperEvent => ({
  id: result.id,
  calendarId: result.calendarId,
  calendarName: result.calendarName,
  calendarProvider: result.calendarProvider,
  calendarUrl: result.calendarUrl,
  description: result.description,
  endTime: result.endTime.toISOString(),
  location: result.location,
  startTime: result.startTime.toISOString(),
  title: result.title,
});

const getEvent = async (
  database: KeeperDatabase,
  userId: string,
  eventId: string,
): Promise<KeeperEvent | null> => {
  const [userEvent] = await database
    .select({
      id: userEventsTable.id,
      calendarId: userEventsTable.calendarId,
      startTime: userEventsTable.startTime,
      endTime: userEventsTable.endTime,
      title: userEventsTable.title,
      description: userEventsTable.description,
      location: userEventsTable.location,
      calendarName: calendarsTable.name,
      calendarProvider: calendarAccountsTable.provider,
      calendarUrl: calendarsTable.url,
    })
    .from(userEventsTable)
    .innerJoin(calendarsTable, eq(userEventsTable.calendarId, calendarsTable.id))
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(
      and(
        eq(userEventsTable.id, eventId),
        eq(userEventsTable.userId, userId),
      ),
    )
    .limit(1);

  if (userEvent) {
    return toKeeperEvent(userEvent);
  }

  const [syncedEvent] = await database
    .select({
      id: eventStatesTable.id,
      calendarId: eventStatesTable.calendarId,
      startTime: eventStatesTable.startTime,
      endTime: eventStatesTable.endTime,
      title: eventStatesTable.title,
      description: eventStatesTable.description,
      location: eventStatesTable.location,
      calendarName: calendarsTable.name,
      calendarProvider: calendarAccountsTable.provider,
      calendarUrl: calendarsTable.url,
    })
    .from(eventStatesTable)
    .innerJoin(calendarsTable, eq(eventStatesTable.calendarId, calendarsTable.id))
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(
      and(
        eq(eventStatesTable.id, eventId),
        eq(calendarsTable.userId, userId),
      ),
    )
    .limit(1);

  if (syncedEvent) {
    return toKeeperEvent(syncedEvent);
  }

  return null;
};

export { getEvent };
