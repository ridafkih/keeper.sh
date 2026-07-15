import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type Redis from "ioredis";

const INVALIDATION_PREFIX = "sync:invalidated:";
const INVALIDATION_TTL_SECONDS = 300;

const invalidateCalendarsForAccount = async (
  database: BunSQLDatabase,
  redis: Redis,
  userId: string,
  accountId: string,
): Promise<boolean> => {
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
    return false;
  }

  const calendarIds = ownedCalendars
    .map(({ calendarId }) => calendarId)
    .filter((calendarId): calendarId is string => calendarId !== null);
  if (calendarIds.length === 0) {
    return true;
  }

  const pipeline = redis.pipeline();
  for (const calendarId of calendarIds) {
    const key = `${INVALIDATION_PREFIX}${calendarId}`;
    pipeline.set(key, "1", "EX", INVALIDATION_TTL_SECONDS);
  }
  await pipeline.exec();
  return true;
};

export { invalidateCalendarsForAccount };
