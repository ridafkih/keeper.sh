import { calendarsTable, userSyncRequestsTable } from "@keeper.sh/database/schema";
import { and, arrayContains, eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const listPushDestinationCalendarIds = async (
  database: BunSQLDatabase,
  userId: string,
): Promise<string[]> => {
  const destinations = await database
    .select({ calendarId: calendarsTable.id })
    .from(calendarsTable)
    .where(and(
      eq(calendarsTable.userId, userId),
      eq(calendarsTable.disabled, false),
      arrayContains(calendarsTable.capabilities, ["push"]),
    ));
  return destinations.map(({ calendarId }) => calendarId);
};

const recordUserSyncRequest = async (
  database: BunSQLDatabase,
  userId: string,
): Promise<void> => {
  const requestId = crypto.randomUUID();
  const requestedAt = new Date();
  await database
    .insert(userSyncRequestsTable)
    .values({ requestId, requestedAt, userId })
    .onConflictDoUpdate({
      target: userSyncRequestsTable.userId,
      set: { requestId, requestedAt },
    });
};

export { listPushDestinationCalendarIds, recordUserSyncRequest };
