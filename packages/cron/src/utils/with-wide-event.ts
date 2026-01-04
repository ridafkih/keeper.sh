import type { CronOptions } from "cronbake";
import {
  WideEvent,
  runWithWideEvent,
  emitWideEvent,
  getWideEvent,
  type WideEventFields,
} from "@keeper.sh/log";

const extractCronContext = (options: CronOptions): Partial<WideEventFields> => ({
  operationType: "job",
  operationName: options.name,
  jobName: options.name,
});

const executeWithWideEvent = async (
  event: WideEvent,
  callback: () => void | Promise<void>
): Promise<void> => {
  return runWithWideEvent(event, async () => {
    try {
      await callback();
    } catch (error) {
      event.setError(error);
      throw error;
    } finally {
      emitWideEvent(event.finalize());
    }
  });
};

export const withCronWideEvent = (options: CronOptions): CronOptions => {
  const { callback, ...restOptions } = options;
  return {
    ...restOptions,
    callback: async () => {
      const event = new WideEvent("cron");
      event.set(extractCronContext(options));
      await executeWithWideEvent(event, callback);
    },
  };
};

export const setCronEventFields = (fields: Partial<WideEventFields>): void => {
  getWideEvent()?.set(fields);
};
