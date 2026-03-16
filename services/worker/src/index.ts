import { entry } from "entrykit";
import { Worker } from "bullmq";
import { PUSH_SYNC_QUEUE_NAME } from "@keeper.sh/queue";
import { closeDatabase } from "@keeper.sh/database";
import { widelog, destroyWideLogger, runWorkerWideEventContext } from "./utils/logging";
import { processJob } from "./processor";
import env from "./env";

const DEFAULT_CONCURRENCY = 5;
const LOCK_DURATION_MS = 360_000;

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
  main: () =>
    runWorkerWideEventContext(async () => {
      widelog.set("operation.name", "worker:start");
      widelog.set("operation.type", "lifecycle");
      widelog.set("request.id", crypto.randomUUID());

      const { database, shutdownConnections } = await import("./context");
      const concurrency = parseConcurrency(env.WORKER_CONCURRENCY);

      try {
        return await widelog.time.measure("duration_ms", () => {
          const worker = new Worker(
            PUSH_SYNC_QUEUE_NAME,
            (job) => runWorkerWideEventContext(() => processJob(job)),
            {
              connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
              concurrency,
              lockDuration: LOCK_DURATION_MS,
            },
          );

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
