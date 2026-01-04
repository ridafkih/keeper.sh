import type { CronOptions } from "cronbake";
import type { Plan } from "@keeper.sh/premium";
import { syncDestinationsForUser } from "@keeper.sh/integrations";
import { fetchAndSyncSource, type Source } from "@keeper.sh/calendar";
import {
  getSourcesByPlan,
  getUsersWithDestinationsByPlan,
} from "./get-sources";
import { withCronWideEvent, setCronEventFields } from "./with-wide-event";
import { database, destinationProviders, syncCoordinator } from "../context";

const syncUserSources = async (userId: string, sources: Source[]) => {
  await Promise.allSettled(
    sources.map((source) => fetchAndSyncSource(database, source)),
  );
  await syncDestinationsForUser(userId, destinationProviders, syncCoordinator);
};

const groupSourcesByUser = (sources: Source[]): Map<string, Source[]> => {
  const sourcesByUser = new Map<string, Source[]>();
  for (const source of sources) {
    const userSources = sourcesByUser.get(source.userId) ?? [];
    userSources.push(source);
    sourcesByUser.set(source.userId, userSources);
  }
  return sourcesByUser;
};

const ensureUsersWithDestinationsIncluded = (
  sourcesByUser: Map<string, Source[]>,
  usersWithDestinations: string[]
): void => {
  for (const userId of usersWithDestinations) {
    if (!sourcesByUser.has(userId)) {
      sourcesByUser.set(userId, []);
    }
  }
};

export const createSyncJob = (plan: Plan, cron: string): CronOptions =>
  withCronWideEvent({
    name: `sync-calendar-events-${plan}`,
    cron,
    immediate: process.env.NODE_ENV !== "production",
    async callback() {
      const sources = await getSourcesByPlan(plan);
      const usersWithDestinations = await getUsersWithDestinationsByPlan(plan);

      setCronEventFields({
        subscriptionPlan: plan,
        sourceCount: sources.length,
        processedCount: usersWithDestinations.length,
      });

      const sourcesByUser = groupSourcesByUser(sources);
      ensureUsersWithDestinationsIncluded(sourcesByUser, usersWithDestinations);

      const userSyncs = Array.from(sourcesByUser.entries()).map(
        ([userId, userSources]) => syncUserSources(userId, userSources)
      );

      const results = await Promise.allSettled(userSyncs);
      const failedCount = results.filter(
        (result) => result.status === "rejected"
      ).length;

      setCronEventFields({ failedCount });
    },
  });
