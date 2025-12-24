import { database } from "@keeper.sh/database";
import { remoteICalSourcesTable } from "@keeper.sh/database/schema";
import { getUserPlan, type Plan } from "@keeper.sh/premium";

export async function getSourcesByPlan(targetPlan: Plan) {
  const sources = await database.select().from(remoteICalSourcesTable);

  const userPlans = new Map<string, Plan>();

  for (const source of sources) {
    if (!userPlans.has(source.userId)) {
      userPlans.set(source.userId, await getUserPlan(source.userId));
    }
  }

  return sources.filter(
    (source) => userPlans.get(source.userId) === targetPlan,
  );
}
