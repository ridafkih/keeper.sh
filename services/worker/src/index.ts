import { entry } from "entrykit";
import { Worker } from "bullmq";
import type { Job } from "bullmq";
import { PUSH_SYNC_QUEUE_NAME } from "@keeper.sh/queue";
import type { PushSyncJobPayload, PushSyncJobResult } from "@keeper.sh/queue";
import { closeDatabase } from "@keeper.sh/database";
import { widelog, destroyWideLogger, runWorkerWideEventContext } from "./utils/logging";
import { processJob } from "./processor";
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

const extractJobFields = (job: Job<PushSyncJobPayload, PushSyncJobResult>) => ({
  "job.id": job.id,
  "job.name": job.name,
  "user.id": job.data.userId,
  "subscription.plan": job.data.plan,
});

await entry({
  main: () =>
    runWorkerWideEventContext(async () => {
      widelog.set("operation.name", "worker:start");
      widelog.set("operation.type", "lifecycle");
      widelog.set("request.id", crypto.randomUUID());

      const { database, shutdownConnections } = await import("./context");
      const concurrency = parseConcurrency(env.WORKER_CONCURRENCY);

      try {
        return widelog.time.measure("duration_ms", () => {
          const activeJobsByUser = new Map<string, string>();

          const worker = new Worker<PushSyncJobPayload, PushSyncJobResult>(
            PUSH_SYNC_QUEUE_NAME,
            (job, token, signal) => runWorkerWideEventContext(() => processJob(job, token, signal)),
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

          worker.on("active", (job) => {
            runWorkerWideEventContext(() => {
              const { userId } = job.data;
              const previousJobId = activeJobsByUser.get(userId);

              if (previousJobId && previousJobId !== job.id) {
                worker.cancelJob(previousJobId, "superseded by newer sync");
                widelog.setFields({
                  "operation.name": "job:supersede",
                  "operation.type": "job",
                  "request.id": crypto.randomUUID(),
                  ...extractJobFields(job),
                  "superseded.job_id": previousJobId,
                  "outcome": "success",
                  "status_code": 200,
                });
                widelog.flush();
              }

              activeJobsByUser.set(userId, job.id ?? "");
            });
          });

          worker.on("completed", (job, result) => {
            runWorkerWideEventContext(() => {
              const currentJobId = activeJobsByUser.get(job.data.userId);
              if (currentJobId === job.id) {
                activeJobsByUser.delete(job.data.userId);
              }

              widelog.setFields({
                "operation.name": "job:completed",
                "operation.type": "job",
                "request.id": crypto.randomUUID(),
                ...extractJobFields(job),
                "events.added": result.added,
                "events.add_failed": result.addFailed,
                "events.removed": result.removed,
                "events.remove_failed": result.removeFailed,
                "outcome": "success",
                "status_code": 200,
              });

              for (const error of result.errors) {
                widelog.append("events.errors", error);
              }

              widelog.flush();
            });
          });

          worker.on("failed", (job, error) => {
            runWorkerWideEventContext(() => {
              if (job) {
                const currentJobId = activeJobsByUser.get(job.data.userId);
                if (currentJobId === job.id) {
                  activeJobsByUser.delete(job.data.userId);
                }
              }

              widelog.setFields({
                "operation.name": "job:failed",
                "operation.type": "job",
                "request.id": crypto.randomUUID(),
                "outcome": "error",
                "status_code": 500,
              });

              if (job) {
                widelog.setFields(extractJobFields(job));
              }

              widelog.errorFields(error);
              widelog.flush();
            });
          });

          worker.on("stalled", (jobId) => {
            runWorkerWideEventContext(() => {
              widelog.setFields({
                "operation.name": "job:stalled",
                "operation.type": "job",
                "request.id": crypto.randomUUID(),
                "job.id": jobId,
                "outcome": "error",
                "status_code": 500,
              });
              widelog.flush();
            });
          });

          worker.on("error", (error) => {
            runWorkerWideEventContext(() => {
              widelog.setFields({
                "operation.name": "worker:error",
                "operation.type": "lifecycle",
                "request.id": crypto.randomUUID(),
                "outcome": "error",
                "status_code": 500,
              });
              widelog.errorFields(error);
              widelog.flush();
            });
          });

          worker.on("lockRenewalFailed", (jobIds) => {
            runWorkerWideEventContext(() => {
              widelog.setFields({
                "operation.name": "worker:lock_renewal_failed",
                "operation.type": "lifecycle",
                "request.id": crypto.randomUUID(),
                "affected_job_count": jobIds.length,
                "outcome": "error",
                "status_code": 500,
              });
              widelog.flush();
            });
          });

          widelog.set("worker.concurrency", concurrency);
          widelog.set("worker.queue", PUSH_SYNC_QUEUE_NAME);
          widelog.set("outcome", "success");
          widelog.set("status_code", 200);

          return async () => {
            await worker.close();
            shutdownConnections();
            closeDatabase(database);
            await destroyWideLogger();
          };
        });
      } catch (error) {
        widelog.set("outcome", "error");
        widelog.set("status_code", 500);
        widelog.errorFields(error);
        throw error;
      } finally {
        widelog.flush();
      }
    }),
  name: "worker",
});
