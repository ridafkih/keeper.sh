import { log } from "@keeper.sh/log";
import type { CronOptions } from "cronbake";

export const injectJobs = (configurations: CronOptions[]) => {
  return configurations.map(({ callback, ...job }) => ({
    ...job,
    callback: new Proxy(callback, {
      async apply(...parameters) {
        log.info("running cron job '%s'", job.name);
        log.trace("cron job '%s' started", job.name);
        const result = await Reflect.apply(...parameters);
        log.trace("cron job '%s' complete", job.name);
        return result;
      },
    }),
  }));
};
