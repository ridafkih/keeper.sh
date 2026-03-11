import type { CronOptions } from "cronbake";
import type { Plan } from "@keeper.sh/premium";
import { syncDestinationsForUser as syncDestinationsForUserAcrossCalendars } from "@keeper.sh/provider-core";
import type { SyncResult } from "@keeper.sh/provider-core";
import { fetchAndSyncSource } from "@keeper.sh/calendar";
import type { Source } from "@keeper.sh/calendar";
import { setCronEventFields, withCronWideEvent } from "./with-wide-event";
import { reportError } from "./logging";

interface SourceOwner {
  userId: string;
}

const ICAL_CALENDAR_TYPE = "ical";

interface SyncUserSourcesDependencies<TSource> {
  fetchAndSyncSourceForCalendar: (source: TSource) => Promise<void>;
  reportError?: (error: unknown, fields?: Record<string, unknown>) => void;
  syncDestinationsForUser: (userId: string) => Promise<SyncResult>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getSourceId = (source: unknown): string | null => {
  if (!isRecord(source)) {
    return null;
  }
  const sourceId = source.id;
  if (typeof sourceId !== "string") {
    return null;
  }
  return sourceId;
};

const createSyncUserSourcesDependencies = async (): Promise<{
  dependencies: SyncUserSourcesDependencies<Source>;
  close: () => void;
}> => {
  const { createSyncContext, database, destinationProviders } = await import("../context");
  const syncContext = createSyncContext();

  return {
    dependencies: {
      fetchAndSyncSourceForCalendar: async (source) => {
        await fetchAndSyncSource(database, source);
      },
      reportError,
      syncDestinationsForUser: (userId) =>
        syncDestinationsForUserAcrossCalendars(
          userId,
          destinationProviders,
          syncContext.syncCoordinator,
        ),
    },
    close: syncContext.close,
  };
};

const syncUserSources = async <TSource>(
  userId: string,
  sources: TSource[],
  dependencies: SyncUserSourcesDependencies<TSource>,
): Promise<SyncResult> => {
  const settlements = await Promise.allSettled(
    sources.map((source) =>
      Promise.resolve().then(() => dependencies.fetchAndSyncSourceForCalendar(source))),
  );

  for (const [index, settlement] of settlements.entries()) {
    if (settlement.status === "rejected") {
      const source = sources[index];
      dependencies.reportError?.(settlement.reason, {
        "operation.name": "sync-calendar-events:fetch-source",
        ...(source && { "source.calendar_id": getSourceId(source) }),
        "user.id": userId,
      });
    }
  }

  return dependencies.syncDestinationsForUser(userId);
};

const groupSourcesByUser = <TSource extends SourceOwner>(sources: TSource[]): Map<string, TSource[]> => {
  const sourcesByUser = new Map<string, TSource[]>();
  for (const source of sources) {
    const userSources = sourcesByUser.get(source.userId) ?? [];
    userSources.push(source);
    sourcesByUser.set(source.userId, userSources);
  }
  return sourcesByUser;
};

const ensureUsersWithDestinationsIncluded = <TSource extends SourceOwner>(
  sourcesByUser: Map<string, TSource[]>,
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

interface SyncJobDependencies<TSource extends SourceOwner> {
  getSourcesByPlan: (plan: Plan) => Promise<TSource[]>;
  getUsersWithDestinationsByPlan: (plan: Plan) => Promise<string[]>;
  reportError?: (error: unknown, fields?: Record<string, unknown>) => void;
  setCronEventFields: (fields: Record<string, unknown>) => void;
  syncUserSourcesForUser: (userId: string, sources: TSource[]) => Promise<SyncResult>;
}

const runSyncJob = async <TSource extends SourceOwner>(
  plan: Plan,
  dependencies: SyncJobDependencies<TSource>,
): Promise<void> => {
  const sources = await dependencies.getSourcesByPlan(plan);
  const usersWithDestinations = await dependencies.getUsersWithDestinationsByPlan(plan);

  dependencies.setCronEventFields({
    "processed.count": usersWithDestinations.length,
    "source.count": sources.length,
    "subscription.plan": plan,
  });

  const sourcesByUser = groupSourcesByUser(sources);
  ensureUsersWithDestinationsIncluded(sourcesByUser, usersWithDestinations);
  const sourceEntries = [...sourcesByUser.entries()];

  const userSyncs = sourceEntries.map(([userId, userSources]) =>
    Promise.resolve().then(() =>
      dependencies.syncUserSourcesForUser(userId, userSources)),
  );

  const settledResults = await Promise.allSettled(userSyncs);
  const userFailedCount = settledResults.filter(
    (result) => result.status === "rejected",
  ).length;

  const totals: SyncResult = {
    addFailed: INITIAL_ADD_FAILED_COUNT,
    added: INITIAL_ADDED_COUNT,
    removeFailed: INITIAL_REMOVE_FAILED_COUNT,
    removed: INITIAL_REMOVED_COUNT,
  };

  for (const [index, settled] of settledResults.entries()) {
    if (settled.status !== "fulfilled") {
      const sourceEntry = sourceEntries[index];
      if (sourceEntry) {
        dependencies.reportError?.(settled.reason, {
          "operation.name": "sync-calendar-events:user-sync",
          "subscription.plan": plan,
          "user.id": sourceEntry[0],
        });
      } else {
        dependencies.reportError?.(settled.reason, {
          "operation.name": "sync-calendar-events:user-sync",
          "subscription.plan": plan,
        });
      }
      continue;
    }
    totals.added += settled.value.added;
    totals.addFailed += settled.value.addFailed;
    totals.removed += settled.value.removed;
    totals.removeFailed += settled.value.removeFailed;
  }

  dependencies.setCronEventFields({
    "events.added": totals.added,
    "events.add_failed": totals.addFailed,
    "events.removed": totals.removed,
    "events.remove_failed": totals.removeFailed,
    "user.failed.count": userFailedCount,
  });
};

const createSyncJob = (plan: Plan, cron: string): CronOptions =>
  withCronWideEvent({
    async callback(): Promise<void> {
      const { dependencies: syncUserSourcesDependencies, close } =
        await createSyncUserSourcesDependencies();
      try {
        const { getSourcesByPlan, getUsersWithDestinationsByPlan } = await import("./get-sources");
        await runSyncJob(plan, {
          getSourcesByPlan: (planToSync) => getSourcesByPlan(planToSync, ICAL_CALENDAR_TYPE),
          getUsersWithDestinationsByPlan,
          reportError,
          setCronEventFields,
          syncUserSourcesForUser: (userId, sources) =>
            syncUserSources(userId, sources, syncUserSourcesDependencies),
        });
      } finally {
        close();
      }
    },
    cron,
    immediate: process.env.ENV !== "production",
    name: `sync-calendar-events-${plan}`,
  });

export { createSyncJob, runSyncJob, syncUserSources };
