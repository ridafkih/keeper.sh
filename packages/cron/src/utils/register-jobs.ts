import { log } from "@keeper.sh/log";
import type { CronOptions, ICron } from "cronbake";
import { baker } from "./baker";

export const registerJobs = (jobs: CronOptions[]): ICron[] => {
  const crons: ICron[] = [];

  log.debug("registering %s jobs", jobs.length);

  for (const job of jobs) {
    log.info("registering job with name '%s'", job.name);
    const cron = baker.add(job);
    crons.push(cron);
  }

  baker.bakeAll();
  return crons;
};
