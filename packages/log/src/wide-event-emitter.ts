import type { WideEventFields, WideEventEmitFunction } from "./wide-event-types";

const formatEventMessage = (event: WideEventFields): string =>
  `${event.serviceBoundary}:${event.operationName ?? "unknown"}`;

export const createWideEventEmitter = (
  logFunction: (fields: Record<string, unknown>, message: string) => void
): WideEventEmitFunction => {
  return (event: WideEventFields): void => {
    logFunction({ wide_event: true, ...event }, formatEventMessage(event));
  };
};
