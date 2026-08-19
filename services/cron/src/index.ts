import { entry } from "entrykit";
import { join } from "node:path";
import { getAllJobs } from "./utils/get-jobs";
import { injectJobs } from "./utils/inject-jobs";
import { registerJobs } from "./utils/register-jobs";
import {
  createMigrationReadinessDatabase,
  waitForDatabaseMigrations,
} from "@keeper.sh/database";
import { destroy } from "./utils/logging";
import { baker } from "./utils/baker";
import { checkWorkerMigrationStatus } from "./migration-check";
import env from "./env";

checkWorkerMigrationStatus(env.WORKER_JOB_QUEUE_ENABLED);

const jobsFolderPathname = join(import.meta.dirname, "jobs");

await entry({
  main: async () => {
    const {
      database,
      shutdownDatabases,
      shutdownRefreshLockRedis,
      shutdownSignalReaderRedis,
      signalReaderRedis,
      refreshLockRedis,
    } = await import("./context");
    const { startPendingSignalReader } = await import("./utils/start-pending-signal-reader");
    await waitForDatabaseMigrations(createMigrationReadinessDatabase(database));

    const jobs = await getAllJobs(jobsFolderPathname);
    const injectedJobs = injectJobs(jobs);
    registerJobs(injectedJobs);

    const signalReader = startPendingSignalReader({
      blockingRedis: signalReaderRedis,
      enabled: Boolean(env.WEBHOOK_PUBLIC_URL),
      scoreRedis: refreshLockRedis,
    });

    return async (): Promise<void> => {
      baker.stopAll();
      await signalReader?.stop();
      destroy();
      await shutdownDatabases();
      shutdownRefreshLockRedis();
      shutdownSignalReaderRedis();
    };
  },
  name: "cron",
});
