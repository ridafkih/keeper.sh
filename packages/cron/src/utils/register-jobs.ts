import type { CronOptions, ICron } from "cronbake";
import { baker } from "./baker";

export const registerJobs = (jobs: CronOptions[]): ICron[] => {
  const crons: ICron[] = [];

  for (const job of jobs) {
    const cron = baker.add(job);
    crons.push(cron);
  }

  baker.bakeAll();
  return crons;
};
