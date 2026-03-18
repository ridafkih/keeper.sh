import {
  calendarsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, eq, inArray } from "drizzle-orm";
import type { Plan } from "@keeper.sh/data-schemas";
import { database, premiumService } from "@/context";
import { filterSourcesByPlan, filterUserIdsByPlan } from "./source-plan-selection";

const fetchCalendars = (calendarType?: string) => {
  if (calendarType) {
    return database
      .select()
      .from(calendarsTable)
      .where(
        and(
          eq(calendarsTable.calendarType, calendarType),
          eq(calendarsTable.disabled, false),
          inArray(calendarsTable.id,
            database.selectDistinct({ id: sourceDestinationMappingsTable.sourceCalendarId })
              .from(sourceDestinationMappingsTable),
          ),
        ),
      );
  }
  return database
    .select()
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.disabled, false),
        inArray(calendarsTable.id,
          database.selectDistinct({ id: sourceDestinationMappingsTable.sourceCalendarId })
            .from(sourceDestinationMappingsTable),
        ),
      ),
    );
};

const getDestinationScopeFilter = () => and(
  arrayContains(calendarsTable.capabilities, ["push"]),
  eq(calendarsTable.disabled, false),
);

const getSourcesByPlan = async (
  targetPlan: Plan,
  calendarType?: string,
): Promise<(typeof calendarsTable.$inferSelect)[]> => {
  const sources = await fetchCalendars(calendarType);
  return filterSourcesByPlan(sources, targetPlan, (userId) => premiumService.getUserPlan(userId));
};

const getUsersWithDestinationsByPlan = async (targetPlan: Plan): Promise<string[]> => {
  const destinations = await database
    .select({ userId: calendarsTable.userId })
    .from(calendarsTable)
    .where(getDestinationScopeFilter());

  return filterUserIdsByPlan(
    destinations.map(({ userId }) => userId),
    targetPlan,
    (userId) => premiumService.getUserPlan(userId),
  );
};

export { getSourcesByPlan, getUsersWithDestinationsByPlan };
