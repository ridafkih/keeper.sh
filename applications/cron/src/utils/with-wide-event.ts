import type { CronOptions } from "cronbake";
import { widelog } from "./logging";

const withCronWideEvent = (options: CronOptions): CronOptions => {
  const { callback, ...restOptions } = options;
  return {
    ...restOptions,
    callback: async () => {
      await widelog.context(async () => {
        widelog.set("operation.type", "job");
        widelog.set("operation.name", options.name);
        widelog.set("job.name", options.name);
        widelog.time.start("duration_ms");
        try {
          await callback();
        } finally {
          widelog.time.stop("duration_ms");
          widelog.flush();
        }
      });
    },
  };
};

const setCronEventFields = (fields: Record<string, unknown>): void => {
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      widelog.set(key, value);
    }
  }
};

export { withCronWideEvent, setCronEventFields };
