import { getAllJobs } from "./utils/get-jobs";
import { injectJobs } from "./utils/inject-jobs";
import { registerJobs } from "./utils/register-jobs";
import { log } from "@keeper.sh/log";
import { join } from "node:path";

const EXIT_CODE_FAILURE = 1;

const jobsFolderPathname = join(import.meta.dirname, "jobs");

getAllJobs(jobsFolderPathname)
  .then(injectJobs)
  .then(registerJobs)
  .catch((error) => {
    log.error({ error }, "Failed to initialize cron jobs");
    process.exit(EXIT_CODE_FAILURE);
  });
