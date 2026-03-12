import type { CronOptions } from "cronbake";
import type { Plan } from "@keeper.sh/premium";
import { syncDestinationsForUser as syncDestinationsForUserAcrossCalendars } from "@keeper.sh/provider-core";
import type { SyncResult } from "@keeper.sh/provider-core";
import { fetchAndSyncSource } from "@keeper.sh/calendar";
import type { Source } from "@keeper.sh/calendar";
import { setCronEventFields, withCronWideEvent } from "./with-wide-event";

interface SourceOwner {
  userId: string;
}

const ICAL_CALENDAR_TYPE = "ical";

interface SyncUserSourcesDependencies<TSource> {
  fetchAndSyncSourceForCalendar: (source: TSource) => Promise<void>;
  syncDestinationsForUser: (userId: string) => Promise<SyncResult>;
  sourceOperationTimeoutMs?: number;
  destinationOperationTimeoutMs?: number;
}

const createSyncUserSourcesDependencies = async (
  jobName: string,
): Promise<{
  dependencies: SyncUserSourcesDependencies<Source>;
  close: () => void;
}> => {
  const { createSyncContext, database } = await import("../context");
  const syncContext = createSyncContext();

  return {
    dependencies: {
      fetchAndSyncSourceForCalendar: async (source) => {
        await fetchAndSyncSource(database, source);
      },
      syncDestinationsForUser: (userId) =>
        syncDestinationsForUserAcrossCalendars(
          userId,
          syncContext.destinationProviders,
          syncContext.syncCoordinator,
          { jobName, jobType: "sync-calendar-events" },
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
  const sourceOperationTimeoutMs = dependencies.sourceOperationTimeoutMs ?? SOURCE_OPERATION_TIMEOUT_MS;
  const destinationOperationTimeoutMs =
    dependencies.destinationOperationTimeoutMs ?? DESTINATION_OPERATION_TIMEOUT_MS;

  await Promise.allSettled(
    sources.map((source) =>
      withOperationTimeout(
        () => dependencies.fetchAndSyncSourceForCalendar(source),
        sourceOperationTimeoutMs,
        "sync:source",
      )),
  );

  return withOperationTimeout(
    () => dependencies.syncDestinationsForUser(userId),
    destinationOperationTimeoutMs,
    "sync:destination",
  );
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
  setCronEventFields: (fields: Record<string, unknown>) => void;
  syncUserSourcesForUser: (userId: string, sources: TSource[]) => Promise<SyncResult>;
  userOperationTimeoutMs?: number;
}

const SOURCE_OPERATION_TIMEOUT_MS = 60_000;
const DESTINATION_OPERATION_TIMEOUT_MS = 300_000;
const USER_OPERATION_TIMEOUT_MS = 300_000;

const withOperationTimeout = async <TResult>(
  operation: () => Promise<TResult>,
  timeoutMs: number,
  operationName: string,
): Promise<TResult> =>
  Promise.race([
    operation(),
    Bun.sleep(timeoutMs).then((): never => {
      throw new Error(`${operationName} timed out after ${timeoutMs}ms`);
    }),
  ]);

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
  const userOperationTimeoutMs = dependencies.userOperationTimeoutMs ?? USER_OPERATION_TIMEOUT_MS;

  const userSyncs = sourceEntries.map(([userId, userSources]) =>
    withOperationTimeout(
      () => dependencies.syncUserSourcesForUser(userId, userSources),
      userOperationTimeoutMs,
      `sync:user:${userId}`,
    ),
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

  for (const settled of settledResults) {
    if (settled.status !== "fulfilled") {
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
      const jobName = `sync-calendar-events-${plan}`;
      const { dependencies: syncUserSourcesDependencies, close } =
        await createSyncUserSourcesDependencies(jobName);
      try {
        const { getSourcesByPlan, getUsersWithDestinationsByPlan } = await import("./get-sources");
        await runSyncJob(plan, {
          getSourcesByPlan: (planToSync) => getSourcesByPlan(planToSync, ICAL_CALENDAR_TYPE),
          getUsersWithDestinationsByPlan,
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
