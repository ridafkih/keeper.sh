import { calendarDestinationsTable, calendarSourcesTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { Plan } from "@keeper.sh/premium";
import { database, premiumService } from "../context";

const fetchSources = (sourceType?: string) => {
  if (sourceType) {
    return database
      .select()
      .from(calendarSourcesTable)
      .where(eq(calendarSourcesTable.sourceType, sourceType));
  }
  return database.select().from(calendarSourcesTable);
};

const getSourcesByPlan = async (
  targetPlan: Plan,
  sourceType?: string,
): Promise<(typeof calendarSourcesTable.$inferSelect)[]> => {
  const sources = await fetchSources(sourceType);

  const userPlans = new Map<string, Plan>();

  for (const source of sources) {
    if (!userPlans.has(source.userId)) {
      userPlans.set(source.userId, await premiumService.getUserPlan(source.userId));
    }
  }

  return sources.filter((source) => userPlans.get(source.userId) === targetPlan);
};

const getUsersWithDestinationsByPlan = async (targetPlan: Plan): Promise<string[]> => {
  const destinations = await database
    .select({ userId: calendarDestinationsTable.userId })
    .from(calendarDestinationsTable);

  const uniqueUserIds = [...new Set(destinations.map(({ userId }) => userId))];
  const usersWithPlan: string[] = [];

  for (const userId of uniqueUserIds) {
    const plan = await premiumService.getUserPlan(userId);
    if (plan === targetPlan) {
      usersWithPlan.push(userId);
    }
  }

  return usersWithPlan;
};

export { getSourcesByPlan, getUsersWithDestinationsByPlan };
