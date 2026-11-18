import { getUserSyncMappings, resolveEffectiveDestinationIds } from "@keeper.sh/calendar";
import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
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

  const mappings = await getUserSyncMappings(database, userId);
  const downstreamCalendarIds = ownedCalendarIds.flatMap((calendarId) =>
    resolveEffectiveDestinationIds(mappings, calendarId));

  return {
    calendarIds: [...new Set([...ownedCalendarIds, ...downstreamCalendarIds])],
    owned: true,
  };
};

export { getCalendarsAffectedByAccountMutation };
