import pino from "pino";
import { createWideEventEmitter } from "./wide-event-emitter";

export const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

export const emitWideEvent = createWideEventEmitter((fields, message) =>
  log.info(fields, message)
);

export { WideEvent } from "./wide-event";
export {
  runWithWideEvent,
  getWideEvent,
  requireWideEvent,
} from "./wide-event-context";
export { createWideEventEmitter } from "./wide-event-emitter";
export type {
  ServiceBoundary,
  WideEventFields,
  WideEventEmitFunction,
} from "./wide-event-types";
