import { entry } from "entrykit";
import { join } from "node:path";
import { getAllJobs } from "./utils/get-jobs";
import { injectJobs } from "./utils/inject-jobs";
import { registerJobs } from "./utils/register-jobs";
import { widelog, destroyWideLogger } from "./utils/logging";
import env from "@keeper.sh/env/cron";

const jobsFolderPathname = join(import.meta.dirname, "jobs");

await entry({
  main: async () => {
    return widelog.context(async () => {
      widelog.set("operation.name", "cron:start");
      widelog.set("operation.type", "lifecycle");
      widelog.set("service.name", "cron");
      widelog.set("commercial.mode", env.COMMERCIAL_MODE ?? false);
      widelog.set("database.url.configured", Boolean(env.DATABASE_URL));

      try {
        const jobs = await getAllJobs(jobsFolderPathname);
        const injectedJobs = injectJobs(jobs);
        registerJobs(injectedJobs);

        widelog.set("job.count", injectedJobs.length);
        widelog.set("outcome", "success");

        return () => {
          destroyWideLogger();
        };
      } catch (error) {
        widelog.set("outcome", "error");
        widelog.errorFields(error);
        throw error;
      } finally {
        widelog.flush();
      }
    });
  },
  name: "cron",
});
