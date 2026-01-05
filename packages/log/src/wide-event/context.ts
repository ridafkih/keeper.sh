import { AsyncLocalStorage } from "node:async_hooks";
import type { WideEvent } from "./event";

const wideEventStorage = new AsyncLocalStorage<WideEvent>();

const runWithWideEvent = <Result>(
  event: WideEvent,
  callback: () => Result | Promise<Result>,
): Result | Promise<Result> => wideEventStorage.run(event, callback);

const getWideEvent = (): WideEvent | undefined => wideEventStorage.getStore();

const requireWideEvent = (): WideEvent => {
  const event = getWideEvent();
  if (!event) {
    throw new Error("No WideEvent in current context");
  }
  return event;
};

export { runWithWideEvent, getWideEvent, requireWideEvent };
