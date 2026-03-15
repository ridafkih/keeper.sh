import { entry } from "entrykit";
import { join } from "node:path";
import { getAllJobs } from "./utils/get-jobs";
import { injectJobs } from "./utils/inject-jobs";
import { registerJobs } from "./utils/register-jobs";
import { closeDatabase } from "@keeper.sh/database";
import { widelog, destroyWideLogger, runCronWideEventContext } from "./utils/logging";
import { database } from "./context";
import env from "./env";

const jobsFolderPathname = join(import.meta.dirname, "jobs");

await entry({
  main: () =>
    runCronWideEventContext(async () => {
      widelog.set("operation.name", "cron:start");
      widelog.set("operation.type", "lifecycle");
      widelog.set("request.id", crypto.randomUUID());
      widelog.set("commercial.mode", env.COMMERCIAL_MODE ?? false);
      widelog.set("database.url.configured", Boolean(env.DATABASE_URL));

      try {
        return await widelog.time.measure("duration_ms", async () => {
          const jobs = await getAllJobs(jobsFolderPathname);
          const injectedJobs = injectJobs(jobs);
          registerJobs(injectedJobs);

          widelog.set("job.count", injectedJobs.length);
          widelog.set("outcome", "success");
          widelog.set("status_code", 200);

          return () => {
            closeDatabase(database);
            destroyWideLogger();
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
  name: "cron",
});
