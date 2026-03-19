import { entry } from "entrykit";
import { Worker } from "bullmq";
import { PUSH_SYNC_QUEUE_NAME } from "@keeper.sh/queue";
import type { PushSyncJobPayload, PushSyncJobResult } from "@keeper.sh/queue";
import { closeDatabase } from "@keeper.sh/database";
import { calendarsTable, sourceDestinationMappingsTable } from "@keeper.sh/database/schema";
import { clearSyncPending, clearSettingsDirty, storeSettingsSnapshot } from "@keeper.sh/calendar";
import { and, eq, inArray } from "drizzle-orm";
import { processJob } from "./processor";
import { destroy } from "./utils/logging";
import env from "./env";

const DEFAULT_CONCURRENCY = 5;
const LOCK_DURATION_MS = 360_000;
const STALLED_INTERVAL_MS = 30_000;
const MAX_STALLED_COUNT = 1;

const parseConcurrency = (value: string | undefined): number => {
  if (!value) {
    return DEFAULT_CONCURRENCY;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return DEFAULT_CONCURRENCY;
  }
  return parsed;
};

await entry({
  main: async () => {
    const { database, shutdownConnections } = await import("./context");
    const concurrency = parseConcurrency(env.WORKER_CONCURRENCY);

    const { syncAggregateRuntime } = await import("./processor");

    const { refreshLockRedis } = await import("./context");

    const snapshotSourceSettings = async (userId: string): Promise<void> => {
      const sourcesWithMappings = database
        .selectDistinct({ id: sourceDestinationMappingsTable.sourceCalendarId })
        .from(sourceDestinationMappingsTable);

      const sources = await database
        .select({
          id: calendarsTable.id,
          customEventName: calendarsTable.customEventName,
          excludeAllDayEvents: calendarsTable.excludeAllDayEvents,
          excludeEventDescription: calendarsTable.excludeEventDescription,
          excludeEventLocation: calendarsTable.excludeEventLocation,
          excludeEventName: calendarsTable.excludeEventName,
          excludeFocusTime: calendarsTable.excludeFocusTime,
          excludeOutOfOffice: calendarsTable.excludeOutOfOffice,
          excludeWorkingLocation: calendarsTable.excludeWorkingLocation,
        })
        .from(calendarsTable)
        .where(
          and(
            eq(calendarsTable.userId, userId),
            inArray(calendarsTable.id, sourcesWithMappings),
          ),
        );

      await Promise.all(
        sources.map((row) => storeSettingsSnapshot(refreshLockRedis, row.id, row)),
      );
    };

    const activeJobsByUser = new Map<string, string>();

    const worker = new Worker<PushSyncJobPayload, PushSyncJobResult>(
      PUSH_SYNC_QUEUE_NAME,
      (job, token, signal) => processJob(job, token, signal),
      {
        connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
        concurrency,
        lockDuration: LOCK_DURATION_MS,
        stalledInterval: STALLED_INTERVAL_MS,
        maxStalledCount: MAX_STALLED_COUNT,
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
        metrics: { maxDataPoints: 1000 },
      },
    );

    worker.on("active", async (job) => {
      const { userId } = job.data;
      const previousJobId = activeJobsByUser.get(userId);

      if (previousJobId && previousJobId !== job.id) {
        worker.cancelJob(previousJobId, "superseded by newer sync");
      }

      activeJobsByUser.set(userId, job.id ?? "");
      syncAggregateRuntime.holdSyncing(userId);
      await Promise.all([
        clearSyncPending(refreshLockRedis, userId),
        clearSettingsDirty(refreshLockRedis, userId),
        snapshotSourceSettings(userId),
      ]);
    });

    worker.on("completed", (job) => {
      const currentJobId = activeJobsByUser.get(job.data.userId);
      if (currentJobId === job.id) {
        activeJobsByUser.delete(job.data.userId);
        syncAggregateRuntime.releaseSyncing(job.data.userId);
      }
    });

    worker.on("failed", (job) => {
      if (job) {
        const currentJobId = activeJobsByUser.get(job.data.userId);
        if (currentJobId === job.id) {
          activeJobsByUser.delete(job.data.userId);
          syncAggregateRuntime.releaseSyncing(job.data.userId);
        }
      }
    });

    return async () => {
      await worker.close();
      shutdownConnections();
      closeDatabase(database);
      await destroy();
    };
  },
  name: "worker",
});
