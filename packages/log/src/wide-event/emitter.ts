import type { WideEventEmitFunction, WideEventFields } from "./types";

const formatEventMessage = (event: WideEventFields): string =>
  `${event.operationName ?? "unknown"}`;

export const createWideEventEmitter =
  (
    logFunction: (fields: Record<string, unknown>, message: string) => void,
  ): WideEventEmitFunction =>
  (event: WideEventFields): void => {
    logFunction(event, formatEventMessage(event));
  };
