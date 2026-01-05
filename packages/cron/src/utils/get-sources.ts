import { calendarDestinationsTable, remoteICalSourcesTable } from "@keeper.sh/database/schema";
import type { Plan } from "@keeper.sh/premium";
import { database, premiumService } from "../context";

const getSourcesByPlan = async (
  targetPlan: Plan,
): Promise<(typeof remoteICalSourcesTable.$inferSelect)[]> => {
  const sources = await database.select().from(remoteICalSourcesTable);

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
