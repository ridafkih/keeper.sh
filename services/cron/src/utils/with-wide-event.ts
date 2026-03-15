import type { CronOptions } from "cronbake";
import { runCronWideEventContext, widelog } from "./logging";

const withCronWideEvent = (options: CronOptions): CronOptions => {
  const { callback, ...restOptions } = options;
  return {
    ...restOptions,
    callback: async () => {
      await runCronWideEventContext(async () => {
        widelog.setFields({
          job: {
            name: options.name,
          },
          operation: {
            name: options.name,
            type: "job",
          },
          request: {
            id: crypto.randomUUID(),
          },
        });
        try {
          await widelog.time.measure("duration_ms", async () => {
            try {
              await callback();
              widelog.set("status_code", 200);
              widelog.set("outcome", "success");
            } catch (error) {
              widelog.set("status_code", 500);
              widelog.set("outcome", "error");
              widelog.errorFields(error);
              throw error;
            }
          });
        } finally {
          widelog.flush();
        }
      });
    },
  };
};

const setCronEventFields = (fields: Record<string, unknown>): void => {
  widelog.setFields(fields);
};

export { withCronWideEvent, setCronEventFields };
