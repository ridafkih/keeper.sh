import { spawnBackgroundJob } from "./background-task";
import { resolveSyncEnqueuePlan } from "./sync-enqueue-plan";
import { enqueuePushSync } from "./enqueue-push-sync";
import { getSourceProvider } from "@keeper.sh/calendar";

const syncOAuthSourcesByProvider = async (providerId: string): Promise<void> => {
  const { database, oauthProviders, refreshLockStore } = await import("@/context");
  const sourceProvider = getSourceProvider(providerId, {
    database,
    oauthProviders,
    refreshLockStore,
  });
  if (!sourceProvider) {
    return;
  }
  await sourceProvider.syncAllSources();
};

const triggerOAuthSourceSync = (input: {
  userId: string;
  provider: string;
  jobName: "oauth-source-sync" | "oauth-account-import";
}): void => {
  spawnBackgroundJob(input.jobName, { userId: input.userId, provider: input.provider }, async () => {
    await syncOAuthSourcesByProvider(input.provider);
    const { premiumService } = await import("@/context");
    const plan = await resolveSyncEnqueuePlan(input.userId, (resolvedUserId) =>
      premiumService.getUserPlan(resolvedUserId),
    );
    await enqueuePushSync(input.userId, plan);
  });
};

export { triggerOAuthSourceSync };
