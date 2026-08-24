import {
  calendarsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, eq, inArray } from "drizzle-orm";
import type { Plan } from "@keeper.sh/data-schemas";
import { database, premiumService } from "@/context";
import { filterSourcesByPlan } from "./source-plan-selection";

interface DestinationCalendarRef {
  calendarId: string;
  userId: string;
}

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

const getDestinationCalendarsByPlan = async (
  targetPlan: Plan,
): Promise<DestinationCalendarRef[]> => {
  const destinations = await database
    .select({
      calendarId: calendarsTable.id,
      userId: calendarsTable.userId,
    })
    .from(calendarsTable)
    .where(getDestinationScopeFilter());

  return filterSourcesByPlan(
    destinations,
    targetPlan,
    (userId) => premiumService.getUserPlan(userId),
  );
};

export {
  getDestinationCalendarsByPlan,
  getSourcesByPlan,
};
export type { DestinationCalendarRef };
