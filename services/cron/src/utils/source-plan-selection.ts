import type { Plan } from "@keeper.sh/data-schemas";

interface SourceWithUserId {
  userId: string;
}

type GetUserPlan = (userId: string) => Promise<Plan>;

const getUniqueUserIds = (userIds: string[]): string[] => [...new Set(userIds)];

const resolveUserPlanMap = async (
  userIds: string[],
  getUserPlan: GetUserPlan,
): Promise<Map<string, Plan>> => {
  const uniqueUserIds = getUniqueUserIds(userIds);
  const userPlans = await Promise.all(
    uniqueUserIds.map(async (userId) => ({
      plan: await getUserPlan(userId),
      userId,
    })),
  );

  return new Map(userPlans.map((userPlan) => [userPlan.userId, userPlan.plan]));
};

const filterSourcesByPlan = async <TSource extends SourceWithUserId>(
  sources: TSource[],
  targetPlan: Plan,
  getUserPlan: GetUserPlan,
): Promise<TSource[]> => {
  const userPlanMap = await resolveUserPlanMap(
    sources.map((source) => source.userId),
    getUserPlan,
  );

  return sources.filter((source) => userPlanMap.get(source.userId) === targetPlan);
};

const filterUserIdsByPlan = async (
  userIds: string[],
  targetPlan: Plan,
  getUserPlan: GetUserPlan,
): Promise<string[]> => {
  const uniqueUserIds = getUniqueUserIds(userIds);
  const userPlanMap = await resolveUserPlanMap(uniqueUserIds, getUserPlan);

  return uniqueUserIds.filter((userId) => userPlanMap.get(userId) === targetPlan);
};

export { filterSourcesByPlan, filterUserIdsByPlan };
