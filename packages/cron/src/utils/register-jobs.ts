import { log } from "@keeper.sh/log";
import type { CronOptions, ICron } from "cronbake";
import { baker } from "./baker";

export const registerJobs = (jobs: CronOptions[]): ICron[] => {
  const crons: ICron[] = [];

  log.info({ jobs }, "registering jobs");

  for (const job of jobs) {
    log.info({ job }, `registering job '${job.name}'`);
    const cron = baker.add(job);
    crons.push(cron);
  }

  baker.bakeAll();
  return crons;
};
