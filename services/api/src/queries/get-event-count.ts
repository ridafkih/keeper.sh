import {
  calendarsTable,
  eventStatesTable,
  userEventsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, count, eq, gte, inArray, lte } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { KeeperDatabase } from "../types";

const EMPTY_RESULT_COUNT = 0;

interface EventCountOptions {
  from?: Date;
  to?: Date;
}

const getEventCount = async (
  database: KeeperDatabase,
  userId: string,
  options?: EventCountOptions,
): Promise<number> => {
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

  const syncedConditions: SQL[] = [inArray(eventStatesTable.calendarId, calendarIds)];
  const userConditions: SQL[] = [
    inArray(userEventsTable.calendarId, calendarIds),
    eq(userEventsTable.userId, userId),
  ];

  if (options?.from) {
    syncedConditions.push(gte(eventStatesTable.startTime, options.from));
    userConditions.push(gte(userEventsTable.startTime, options.from));
  }

  if (options?.to) {
    syncedConditions.push(lte(eventStatesTable.startTime, options.to));
    userConditions.push(lte(userEventsTable.startTime, options.to));
  }

  const [syncedResult] = await database
    .select({ count: count() })
    .from(eventStatesTable)
    .where(and(...syncedConditions));

  const [userResult] = await database
    .select({ count: count() })
    .from(userEventsTable)
    .where(and(...userConditions));

  const syncedCount = syncedResult?.count ?? 0;
  const userCount = userResult?.count ?? 0;

  return syncedCount + userCount;
};

export { getEventCount };
export type { EventCountOptions };
