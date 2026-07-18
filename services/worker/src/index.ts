import { entry } from "entrykit";
import { Worker } from "bullmq";
import { PUSH_SYNC_QUEUE_NAME } from "@keeper.sh/queue";
import type { PushSyncJobPayload, PushSyncJobResult } from "@keeper.sh/queue";
import { closeDatabase } from "@keeper.sh/database";
import { processJob } from "./processor";
import { createActiveDestinationJobs } from "./active-destination-jobs";
import { destroy } from "./utils/logging";
import env from "./env";

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

    const activeDestinationJobs = createActiveDestinationJobs({
      beginUserRun: (userId) => syncAggregateRuntime.beginSyncRun(userId),
      cancelJob: (jobId) => worker.cancelJob(jobId, "superseded by newer destination sync"),
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
      shutdownConnections();
      closeDatabase(database);
      await destroy();
    };
  },
  name: "worker",
});
