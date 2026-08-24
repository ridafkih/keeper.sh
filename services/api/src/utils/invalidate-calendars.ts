import {
  calendarAccountsTable,
  calendarsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const getCalendarsAffectedByAccountMutation = async (
  database: BunSQLDatabase,
  userId: string,
  accountId: string,
): Promise<{ calendarIds: string[]; owned: boolean }> => {
  const ownedCalendars = await database
    .select({ calendarId: calendarsTable.id })
    .from(calendarAccountsTable)
    .leftJoin(calendarsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(
      and(
        eq(calendarAccountsTable.id, accountId),
        eq(calendarAccountsTable.userId, userId),
      ),
    );

  if (ownedCalendars.length === 0) {
    return { calendarIds: [], owned: false };
  }

  const ownedCalendarIds = ownedCalendars
    .map(({ calendarId }) => calendarId)
    .filter((calendarId): calendarId is string => calendarId !== null);
  if (ownedCalendarIds.length === 0) {
    return { calendarIds: [], owned: true };
  }

  const mappedDestinations = await database
    .select({ calendarId: sourceDestinationMappingsTable.destinationCalendarId })
    .from(sourceDestinationMappingsTable)
    .where(inArray(sourceDestinationMappingsTable.sourceCalendarId, ownedCalendarIds));

  return {
    calendarIds: [...new Set([
      ...ownedCalendarIds,
      ...mappedDestinations.map(({ calendarId }) => calendarId),
    ])],
    owned: true,
  };
};

export { getCalendarsAffectedByAccountMutation };
