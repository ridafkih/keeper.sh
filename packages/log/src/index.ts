import pino from "pino";
import { createWideEventEmitter } from "./wide-event/emitter";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

const emitWideEvent = createWideEventEmitter((fields, message) => log.info(fields, message));

export { log, emitWideEvent };
export { WideEvent } from "./wide-event/event";
export { runWithWideEvent, getWideEvent, requireWideEvent } from "./wide-event/context";
export { createWideEventEmitter } from "./wide-event/emitter";
export type { ServiceBoundary, WideEventFields, WideEventEmitFunction } from "./wide-event/types";
