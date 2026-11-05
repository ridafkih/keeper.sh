import { exitUnlessTimeZoneDataCurrent } from "@keeper.sh/calendar";
import { entry } from "entrykit";
import { Worker } from "bullmq";
import { PUSH_SYNC_QUEUE_NAME, createPushSyncQueue } from "@keeper.sh/queue";
import type { PushSyncJobPayload, PushSyncJobResult } from "@keeper.sh/queue";
import {
  closeDatabase,
  createMigrationReadinessDatabase,
  waitForDatabaseMigrations,
} from "@keeper.sh/database";
import { processJob } from "./processor";
import { createActiveDestinationJobs } from "./active-destination-jobs";
import { enqueueSyncContinuation, requestsContinuation } from "./utils/sync-continuation";
import { context, destroy, widelog } from "./utils/logging";
import env from "./env";

exitUnlessTimeZoneDataCurrent(process.env.ICU_TIMEZONE_FILES_DIR);

const DEFAULT_CONCURRENCY = 25;
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
    await waitForDatabaseMigrations(createMigrationReadinessDatabase(database));
    const concurrency = parseConcurrency(env.WORKER_CONCURRENCY);

    const { syncAggregateRuntime } = await import("./processor");

    const worker = new Worker<PushSyncJobPayload, PushSyncJobResult>(
      PUSH_SYNC_QUEUE_NAME,
      (job, token, signal) => processJob(job, token, signal),
      {
        connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
        concurrency,
        lockDuration: LOCK_DURATION_MS,
        stalledInterval: STALLED_INTERVAL_MS,
        maxStalledCount: MAX_STALLED_COUNT,
        removeOnComplete: { count: 0 },
        removeOnFail: { count: 500 },
        metrics: { maxDataPoints: 1000 },
      },
    );

    const continuationQueue = createPushSyncQueue({ url: env.REDIS_URL, maxRetriesPerRequest: null });

    const continueCutShortJob = (job: Parameters<typeof enqueueSyncContinuation>[1]): Promise<void> => {
      if (!requestsContinuation(job)) {
        return Promise.resolve();
      }
      return context(async () => {
        widelog.set("operation.name", "push-sync-continuation");
        widelog.set("operation.type", "internal");
        widelog.set("user.id", job.data.userId);
        widelog.set("calendar.id", job.data.calendarId);
        try {
          await widelog.time.measure("duration_ms", () => enqueueSyncContinuation(continuationQueue, job));
          widelog.set("outcome", "success");
        } catch (error) {
          widelog.set("outcome", "error");
          widelog.errorFields(error, { slug: "sync-continuation-enqueue-failed" });
        }
        widelog.flush();
      });
    };

    const activeDestinationJobs = createActiveDestinationJobs({
      beginUserRun: (userId) => syncAggregateRuntime.beginSyncRun(userId),
      releaseUserRun: (userId) => {
        syncAggregateRuntime.releaseSyncing(userId);
      },
    });

    worker.on("active", (job) => {
      activeDestinationJobs.onActive({
        calendarId: job.data.calendarId,
        id: job.id ?? "",
        userId: job.data.userId,
      });
    });

    worker.on("completed", (job) => {
      continueCutShortJob(job);
      activeDestinationJobs.onSettled({
        calendarId: job.data.calendarId,
        id: job.id ?? "",
        userId: job.data.userId,
      });
    });

    worker.on("failed", (job) => {
      if (job) {
        activeDestinationJobs.onSettled({
          calendarId: job.data.calendarId,
          id: job.id ?? "",
          userId: job.data.userId,
        });
      }
    });

    return async () => {
      activeDestinationJobs.close();
      await worker.close();
      await continuationQueue.close();
      shutdownConnections();
      closeDatabase(database);
      await destroy();
    };
  },
  name: "worker",
});
