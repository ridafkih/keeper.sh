import {
  calendarAccountsTable,
  calendarsTable,
  eventStatesTable,
} from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import type { KeeperDatabase, KeeperEvent } from "../types";

const getEvent = async (
  database: KeeperDatabase,
  userId: string,
  eventId: string,
): Promise<KeeperEvent | null> => {
  const [result] = await database
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

  if (!result) {
    return null;
  }

  return {
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
  };
};

export { getEvent };
