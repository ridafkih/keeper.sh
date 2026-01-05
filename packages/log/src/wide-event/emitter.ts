import type {
  WideEventFields,
  WideEventEmitFunction,
} from "./types";

const formatEventMessage = (event: WideEventFields): string =>
  `${event.operationName ?? "unknown"}`;

export const createWideEventEmitter = (
  logFunction: (fields: Record<string, unknown>, message: string) => void,
): WideEventEmitFunction => {
  return (event: WideEventFields): void => {
    logFunction(event, formatEventMessage(event));
  };
};
