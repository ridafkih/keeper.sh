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
import { resolveIngestDials } from "./ingest/ingest-dials";
import type { IngestDials } from "./ingest/ingest-dials";
import type { IngestScheduler } from "./ingest/start-ingest-scheduler";
import env from "./env";

checkWorkerMigrationStatus(env.WORKER_JOB_QUEUE_ENABLED);

const jobsFolderPathname = join(import.meta.dirname, "jobs");

const INGEST_SHUTDOWN_DEADLINE_MS = 5000;

const startIngestSchedulerWhenEnabled = async (dials: IngestDials): Promise<IngestScheduler | null> => {
  if (!dials.loopEnabled) {
    return null;
  }
  const { startIngestScheduler } = await import("./ingest/start-ingest-scheduler");
  return startIngestScheduler(dials);
};

await entry({
  main: async () => {
    const {
      database,
      shutdownDatabases,
      shutdownRefreshLockRedis,
    } = await import("./context");
    await waitForDatabaseMigrations(createMigrationReadinessDatabase(database));

    if (env.CRON_JOBS_ENABLED !== false) {
      const jobs = await getAllJobs(jobsFolderPathname);
      registerJobs(injectJobs(jobs));
    }

    const scheduler = await startIngestSchedulerWhenEnabled(resolveIngestDials(env));

    return async (): Promise<void> => {
      baker.stopAll();
      await scheduler?.stop(INGEST_SHUTDOWN_DEADLINE_MS);
      destroy();
      await shutdownDatabases();
      shutdownRefreshLockRedis();
    };
  },
  name: "cron",
});
