import { getAllJobs } from "./utils/get-jobs";
import { injectJobs } from "./utils/inject-jobs";
import { registerJobs } from "./utils/register-jobs";
import { WideEvent, emitWideEvent } from "@keeper.sh/log";
import { join } from "node:path";

const EXIT_CODE_FAILURE = 1;

const jobsFolderPathname = join(import.meta.dirname, "jobs");

const emitSuccessEvent = (jobCount: number): void => {
  const event = new WideEvent("cron");
  event.set({
    operationType: "lifecycle",
    operationName: "cron:start",
    jobCount,
  });
  emitWideEvent(event.finalize());
};

const emitFailureEvent = (error: unknown): void => {
  const event = new WideEvent("cron");
  event.set({
    operationType: "lifecycle",
    operationName: "cron:start",
  });
  event.setError(error);
  emitWideEvent(event.finalize());
};

getAllJobs(jobsFolderPathname)
  .then(injectJobs)
  .then((jobs) => {
    registerJobs(jobs);
    emitSuccessEvent(jobs.length);
    return jobs;
  })
  .catch((error) => {
    emitFailureEvent(error);
    process.exit(EXIT_CODE_FAILURE);
  });
