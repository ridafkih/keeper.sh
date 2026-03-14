import {
  calendarsTable,
  eventStatesTable,
  userEventsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, count, eq, inArray } from "drizzle-orm";
import type { KeeperDatabase } from "../types";

const EMPTY_RESULT_COUNT = 0;

const getEventCount = async (database: KeeperDatabase, userId: string): Promise<number> => {
  const sources = await database
    .select({ id: calendarsTable.id })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.userId, userId),
        arrayContains(calendarsTable.capabilities, ["pull"]),
      ),
    );

  if (sources.length === EMPTY_RESULT_COUNT) {
    return 0;
  }

  const calendarIds = sources.map((source) => source.id);

  const [syncedResult] = await database
    .select({ count: count() })
    .from(eventStatesTable)
    .where(inArray(eventStatesTable.calendarId, calendarIds));

  const [userResult] = await database
    .select({ count: count() })
    .from(userEventsTable)
    .where(
      and(
        inArray(userEventsTable.calendarId, calendarIds),
        eq(userEventsTable.userId, userId),
      ),
    );

  const syncedCount = syncedResult?.count ?? 0;
  const userCount = userResult?.count ?? 0;

  return syncedCount + userCount;
};

export { getEventCount };
