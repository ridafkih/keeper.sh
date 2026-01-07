import type { CronOptions } from "cronbake";
import { WideEvent } from "@keeper.sh/log";

const withCronWideEvent = (options: CronOptions): CronOptions => {
  const { callback, ...restOptions } = options;
  return {
    ...restOptions,
    callback: async () => {
      const event = new WideEvent();
      event.set({
        "operation.type": "job",
        "operation.name": options.name,
        "job.name": options.name,
      });

      await event.run(async () => {
        try {
          await callback();
        } catch (error) {
          event.addError(error);
          throw error;
        } finally {
          event.emit();
        }
      });
    },
  };
};

const setCronEventFields = (fields: Record<string, unknown>): void => {
  WideEvent.grasp()?.set(fields);
};

export { withCronWideEvent, setCronEventFields };
