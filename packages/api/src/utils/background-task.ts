import { WideEvent, emitWideEvent, runWithWideEvent } from "@keeper.sh/log";
import type { WideEventFields } from "@keeper.sh/log";

type BackgroundTaskCallback<TResult> = () => Promise<TResult>;

const executeBackgroundTask = <TResult>(
  operationName: string,
  fields: Partial<WideEventFields>,
  callback: BackgroundTaskCallback<TResult>,
): void => {
  const event = new WideEvent("api");
  event.set({
    operationName,
    operationType: "background",
    ...fields,
  });

  runWithWideEvent(event, async () => {
    try {
      const result = await callback();
      if (result && typeof result === "object") {
        event.set(result as Partial<WideEventFields>);
      }
    } catch (error) {
      event.setError(error);
    } finally {
      emitWideEvent(event.finalize());
    }
  });
};

export { executeBackgroundTask };
