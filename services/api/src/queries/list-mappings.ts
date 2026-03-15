import {
  calendarsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { KeeperDatabase, KeeperMapping } from "@/types";

const EMPTY_RESULT_COUNT = 0;

const listMappings = async (database: KeeperDatabase, userId: string): Promise<KeeperMapping[]> => {
  const userSourceCalendars = await database
    .select({
      calendarType: calendarsTable.calendarType,
      id: calendarsTable.id,
    })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.userId, userId),
        inArray(
          calendarsTable.id,
          database
            .selectDistinct({ id: sourceDestinationMappingsTable.sourceCalendarId })
            .from(sourceDestinationMappingsTable),
        ),
      ),
    );

  if (userSourceCalendars.length === EMPTY_RESULT_COUNT) {
    return [];
  }

  const calendarIds = userSourceCalendars.map((calendar) => calendar.id);
  const typeByCalendarId = new Map(
    userSourceCalendars.map((calendar) => [calendar.id, calendar.calendarType]),
  );

  const mappings = await database
    .select()
    .from(sourceDestinationMappingsTable)
    .where(inArray(sourceDestinationMappingsTable.sourceCalendarId, calendarIds));

  return mappings.map((mapping) => {
    const calendarType = typeByCalendarId.get(mapping.sourceCalendarId);

    if (!calendarType) {
      throw new Error(`No calendar type found for source calendar: ${mapping.sourceCalendarId}`);
    }

    return {
      ...mapping,
      calendarType,
      createdAt: mapping.createdAt.toISOString(),
    };
  });
};

export { listMappings };
