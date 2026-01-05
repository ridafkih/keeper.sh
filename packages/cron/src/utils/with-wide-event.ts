import type { CronOptions } from "cronbake";
import { WideEvent, emitWideEvent, getWideEvent, runWithWideEvent } from "@keeper.sh/log";
import type { WideEventFields } from "@keeper.sh/log";

const extractCronContext = (options: CronOptions): Partial<WideEventFields> => ({
  jobName: options.name,
  operationName: options.name,
  operationType: "job",
});

const executeWithWideEvent = async (
  event: WideEvent,
  callback: () => void | Promise<void>,
): Promise<void> => {
  await runWithWideEvent(event, async () => {
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

const withCronWideEvent = (options: CronOptions): CronOptions => {
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

const setCronEventFields = (fields: Partial<WideEventFields>): void => {
  getWideEvent()?.set(fields);
};

export { withCronWideEvent, setCronEventFields };
