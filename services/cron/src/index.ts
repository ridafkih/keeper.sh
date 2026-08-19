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
    const { database, shutdownDatabases, shutdownRefreshLockRedis } = await import("./context");
    await waitForDatabaseMigrations(createMigrationReadinessDatabase(database));

    const jobs = await getAllJobs(jobsFolderPathname);
    const injectedJobs = injectJobs(jobs);
    registerJobs(injectedJobs);

    return async (): Promise<void> => {
      baker.stopAll();
      destroy();
      /*
       * Order is load-bearing: shutdownDatabases() begins with the registered
       * flush drain, and every drained flush re-probes currency at persist
       * time through a redis.eval on the sync-lock handle. Disconnecting
       * refreshLockRedis first makes that probe reject, so the flush reports
       * "currency-unconfirmed" and discards the payload the drain exists to
       * persist. Redis must outlive the drain.
       */
      await shutdownDatabases();
      shutdownRefreshLockRedis();
    };
  },
  name: "cron",
});
