import { entry } from "entrykit";
import { join } from "node:path";
import { getAllJobs } from "./utils/get-jobs";
import { injectJobs } from "./utils/inject-jobs";
import { registerJobs } from "./utils/register-jobs";
import { closeDatabase } from "@keeper.sh/database";

const jobsFolderPathname = join(import.meta.dirname, "jobs");

await entry({
  main: async () => {
    const { database, shutdownRefreshLockRedis } = await import("./context");

    const jobs = await getAllJobs(jobsFolderPathname);
    const injectedJobs = injectJobs(jobs);
    registerJobs(injectedJobs);

    return () => {
      shutdownRefreshLockRedis();
      closeDatabase(database);
    };
  },
  name: "cron",
});
