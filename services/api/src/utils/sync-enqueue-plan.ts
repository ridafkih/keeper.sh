class SyncEnqueuePlanResolutionError extends Error {
  constructor(userId: string) {
    super(`Unable to resolve user plan for sync enqueue for user ${userId}`);
  }
}

const resolveSyncEnqueuePlan = async <TPlan>(
  userId: string,
  getUserPlan: (userId: string) => Promise<TPlan | null>,
): Promise<TPlan> => {
  const plan = await getUserPlan(userId);
  if (!plan) {
    throw new SyncEnqueuePlanResolutionError(userId);
  }
  return plan;
};

export { SyncEnqueuePlanResolutionError, resolveSyncEnqueuePlan };
