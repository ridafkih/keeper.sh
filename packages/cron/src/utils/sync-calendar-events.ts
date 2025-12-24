import type { CronOptions } from "cronbake";
import { log } from "@keeper.sh/log";
import { syncDestinationsForUser } from "@keeper.sh/integrations";
import "@keeper.sh/integration-google-calendar";
import { fetchAndSyncSource, type Source } from "@keeper.sh/calendar";
import type { Plan } from "@keeper.sh/premium";
import { getSourcesByPlan } from "./get-sources";

const syncUserSources = async (userId: string, sources: Source[]) => {
  await Promise.allSettled(sources.map(fetchAndSyncSource));
  await syncDestinationsForUser(userId);
};

export const createSyncJob = (plan: Plan, cron: string): CronOptions => ({
  name: `sync-calendar-events-${plan}`,
  cron,
  immediate: true,
  async callback() {
    const sources = await getSourcesByPlan(plan);
    log.debug("syncing %s %s sources", sources.length, plan);

    const sourcesByUser = new Map<string, Source[]>();
    for (const source of sources) {
      const userSources = sourcesByUser.get(source.userId) ?? [];
      userSources.push(source);
      sourcesByUser.set(source.userId, userSources);
    }

    const userSyncs = Array.from(sourcesByUser.entries()).map(
      ([userId, userSources]) => syncUserSources(userId, userSources),
    );

    await Promise.allSettled(userSyncs);
  },
});
