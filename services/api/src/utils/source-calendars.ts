import { calendarsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { database, redis } from "@/context";

const INVALIDATION_PREFIX = "sync:invalidated:";
const INVALIDATION_TTL_SECONDS = 300;
const EMPTY_RESULT_COUNT = 0;

const deleteSourceCalendar = async (userId: string, calendarId: string): Promise<boolean> => {
  const result = await database
    .delete(calendarsTable)
    .where(
      and(
        eq(calendarsTable.id, calendarId),
        eq(calendarsTable.userId, userId),
      ),
    )
    .returning({ id: calendarsTable.id });

  if (result.length === EMPTY_RESULT_COUNT) {
    return false;
  }

  await redis.set(`${INVALIDATION_PREFIX}${calendarId}`, "1", "EX", INVALIDATION_TTL_SECONDS);
  return true;
};

export { deleteSourceCalendar };
