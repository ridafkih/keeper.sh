import type { CronOptions } from "cronbake";
import type { Plan } from "@keeper.sh/premium";
import { syncDestinationsForUser } from "@keeper.sh/provider-core";
import type { SyncResult } from "@keeper.sh/provider-core";
import { fetchAndSyncSource } from "@keeper.sh/calendar";
import type { Source } from "@keeper.sh/calendar";
import { getSourcesByPlan, getUsersWithDestinationsByPlan } from "./get-sources";
import { setCronEventFields, withCronWideEvent } from "./with-wide-event";
import { database, destinationProviders, syncCoordinator } from "../context";

const syncUserSources = async (userId: string, sources: Source[]): Promise<SyncResult> => {
  await Promise.allSettled(sources.map((source) => fetchAndSyncSource(database, source)));
  return syncDestinationsForUser(userId, destinationProviders, syncCoordinator);
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
  usersWithDestinations: string[],
): void => {
  for (const userId of usersWithDestinations) {
    if (!sourcesByUser.has(userId)) {
      sourcesByUser.set(userId, []);
    }
  }
};

const INITIAL_ADDED_COUNT = 0;
const INITIAL_ADD_FAILED_COUNT = 0;
const INITIAL_REMOVED_COUNT = 0;
const INITIAL_REMOVE_FAILED_COUNT = 0;

const createSyncJob = (plan: Plan, cron: string): CronOptions =>
  withCronWideEvent({
    async callback(): Promise<void> {
      const sources = await getSourcesByPlan(plan);
      const usersWithDestinations = await getUsersWithDestinationsByPlan(plan);

      setCronEventFields({
        "processed.count": usersWithDestinations.length,
        "source.count": sources.length,
        "subscription.plan": plan,
      });

      const sourcesByUser = groupSourcesByUser(sources);
      ensureUsersWithDestinationsIncluded(sourcesByUser, usersWithDestinations);

      const userSyncs = [...sourcesByUser.entries()].map(([userId, userSources]) =>
        syncUserSources(userId, userSources),
      );

      const settledResults = await Promise.allSettled(userSyncs);
      const userFailedCount = settledResults.filter((result) => result.status === "rejected").length;

      const totals: SyncResult = {
        addFailed: INITIAL_ADD_FAILED_COUNT,
        added: INITIAL_ADDED_COUNT,
        removeFailed: INITIAL_REMOVE_FAILED_COUNT,
        removed: INITIAL_REMOVED_COUNT,
      };

      for (const settled of settledResults) {
        if (settled.status !== "fulfilled") {
          continue;
        }
        totals.added += settled.value.added;
        totals.addFailed += settled.value.addFailed;
        totals.removed += settled.value.removed;
        totals.removeFailed += settled.value.removeFailed;
      }

      setCronEventFields({
        "events.added": totals.added,
        "events.add_failed": totals.addFailed,
        "events.removed": totals.removed,
        "events.remove_failed": totals.removeFailed,
        "user.failed.count": userFailedCount,
      });
    },
    cron,
    immediate: process.env.NODE_ENV !== "production",
    name: `sync-calendar-events-${plan}`,
  });

export { createSyncJob };
