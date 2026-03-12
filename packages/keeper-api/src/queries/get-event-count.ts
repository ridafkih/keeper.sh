import {
  calendarsTable,
  eventStatesTable,
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

  const [result] = await database
    .select({ count: count() })
    .from(eventStatesTable)
    .where(inArray(eventStatesTable.calendarId, calendarIds));

  if (!result) {
    throw new Error("Event count query returned no result");
  }

  return result.count;
};

export { getEventCount };
