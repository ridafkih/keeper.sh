import { entry } from "entrykit";
import { Worker } from "bullmq";
import { PUSH_SYNC_QUEUE_NAME } from "@keeper.sh/queue";
import type { PushSyncJobPayload, PushSyncJobResult } from "@keeper.sh/queue";
import { closeDatabase } from "@keeper.sh/database";
import { RedisCommandOutboxStore } from "@keeper.sh/machine-orchestration";
import { calendarAccountsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import { processJob } from "./processor";
import { destroy } from "./utils/logging";
import env from "./env";
import { createPushJobArbitrationRuntime } from "./push-job-arbitration-runtime";
import { recoverCredentialHealthOutbox } from "./recovery/credential-health-outbox-recovery";
import type { CredentialHealthCommand } from "@keeper.sh/state-machines";

const DEFAULT_CONCURRENCY = 5;
const LOCK_DURATION_MS = 360_000;
const STALLED_INTERVAL_MS = 30_000;
const MAX_STALLED_COUNT = 1;
const RECOVERY_INTERVAL_MS = 10_000;

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

const requireJobId = (job: { id?: string }): string => {
  const { id } = job;
  if (!id) {
    throw new Error("Worker invariant violated: job.id is required");
  }
  return id;
};

const toWorkerError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
};

await entry({
  main: async () => {
    const { database, refreshLockRedis, shutdownConnections } = await import("./context");
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
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
        metrics: { maxDataPoints: 1000 },
      },
    );

    const pushArbitrationRuntime = createPushJobArbitrationRuntime({
      outboxStore: new RedisCommandOutboxStore({
        keyPrefix: "machine:outbox:push-arbitration",
        redis: refreshLockRedis,
      }),
      onRuntimeEvent: () => Promise.resolve(),
      syncing: {
        holdSyncing: (userId) => syncAggregateRuntime.holdSyncing(userId),
        releaseSyncing: (userId) => syncAggregateRuntime.releaseSyncing(userId),
      },
      worker: {
        cancelJob: (jobId, reason) => worker.cancelJob(jobId, reason),
      },
    });
    await pushArbitrationRuntime.recoverPending();
    const credentialHealthOutboxStore = new RedisCommandOutboxStore<CredentialHealthCommand>({
      keyPrefix: "machine:outbox:credential-health",
      redis: refreshLockRedis,
    });
    await recoverCredentialHealthOutbox({
      outboxStore: credentialHealthOutboxStore,
      markNeedsReauthentication: async (oauthCredentialId) => {
        await database
          .update(calendarAccountsTable)
          .set({ needsReauthentication: true })
          .where(eq(calendarAccountsTable.oauthCredentialId, oauthCredentialId));
      },
    });
    const recoveryInterval = setInterval(() => {
      Promise.all([
        pushArbitrationRuntime.recoverPending(),
        recoverCredentialHealthOutbox({
          outboxStore: credentialHealthOutboxStore,
          markNeedsReauthentication: async (oauthCredentialId) => {
            await database
              .update(calendarAccountsTable)
              .set({ needsReauthentication: true })
              .where(eq(calendarAccountsTable.oauthCredentialId, oauthCredentialId));
          },
        }),
      ]).catch((error) => {
        worker.emit("error", toWorkerError(error));
      });
    }, RECOVERY_INTERVAL_MS);

    worker.on("active", (job) => {
      const jobId = requireJobId(job);
      pushArbitrationRuntime
        .onJobActive({
          jobId,
          userId: job.data.userId,
        })
        .catch((error) => {
          worker.emit("error", toWorkerError(error));
        });
    });

    worker.on("completed", (job) => {
      const jobId = requireJobId(job);
      pushArbitrationRuntime
        .onJobCompleted({
          jobId,
          userId: job.data.userId,
        })
        .catch((error) => {
          worker.emit("error", toWorkerError(error));
        });
    });

    worker.on("failed", (job) => {
      if (job) {
        const jobId = requireJobId(job);
        pushArbitrationRuntime
          .onJobFailed({
            jobId,
            userId: job.data.userId,
          })
          .catch((error) => {
            worker.emit("error", toWorkerError(error));
          });
      }
    });

    return async () => {
      clearInterval(recoveryInterval);
      await worker.close();
      shutdownConnections();
      closeDatabase(database);
      await destroy();
    };
  },
  name: "worker",
});
