import { AsyncLocalStorage } from "node:async_hooks";
import { WideEvent } from "./wide-event";

const wideEventStorage = new AsyncLocalStorage<WideEvent>();

export const runWithWideEvent = <Result>(
  event: WideEvent,
  callback: () => Result | Promise<Result>
): Result | Promise<Result> => wideEventStorage.run(event, callback);

export const getWideEvent = (): WideEvent | undefined => wideEventStorage.getStore();

export const requireWideEvent = (): WideEvent => {
  const event = getWideEvent();
  if (!event) throw new Error("No WideEvent in current context");
  return event;
};
