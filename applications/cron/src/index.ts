import { entry } from "@keeper.sh/entry-point";
import { schema } from "@keeper.sh/env/cron";
import { join } from "node:path";
import { getAllJobs } from "./utils/get-jobs";
import { injectJobs } from "./utils/inject-jobs";
import { registerJobs } from "./utils/register-jobs";

const jobsFolderPathname = join(import.meta.dirname, "jobs");

entry()
  .env(schema)
  .run(async ({ context }) => {
    const jobs = await getAllJobs(jobsFolderPathname);
    const injectedJobs = injectJobs(jobs);
    registerJobs(injectedJobs);

    context.set("jobCount", injectedJobs.length);
  });
