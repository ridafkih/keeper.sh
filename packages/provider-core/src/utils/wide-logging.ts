import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { widelogger, type WideloggerOptions } from "widelogger";
import { DEFAULT_EVENT_NAME, getDefaultLoggerConfig, getDefaultServiceName, type LoggerConfig } from "./wide-logging-config";

const DEFAULT_ERROR_OPERATION_NAME = "unhandled-error";
const ERROR_STATUS_CODE = 500;
const DEFAULT_ERROR_TYPE = "UnknownError";

interface WideLogContext {
  requestId: string;
  startedAtMs: number;
  seenErrorMessagesByType: Map<string, Set<string>>;
  timingStartsByName: Map<string, number>;
}

interface LoggerRuntime {
  destroy: () => Promise<void>;
  widelog: ReturnType<typeof widelogger>["widelog"];
}

interface ErrorDetails {
  errorMessage: string;
  errorType: string;
}

const contextStore = new AsyncLocalStorage<WideLogContext>();

let activeConfig: LoggerConfig = getDefaultLoggerConfig();
let activeRuntime: LoggerRuntime = widelogger(activeConfig);

const isSameConfig = (left: LoggerConfig, right: LoggerConfig): boolean =>
  left.commitHash === right.commitHash &&
  left.defaultEventName === right.defaultEventName &&
  left.environment === right.environment &&
  left.instanceId === right.instanceId &&
  left.level === right.level &&
  left.service === right.service &&
  left.version === right.version;

const getRuntime = (): LoggerRuntime => activeRuntime;

const emitRuntimeError = (error: unknown, operationName: string): void => {
  activeRuntime.widelog.context(() => {
    activeRuntime.widelog.set("operation.name", operationName);
    activeRuntime.widelog.set("operation.type", "logging");
    activeRuntime.widelog.set("outcome", "error");
    activeRuntime.widelog.errorFields(error, { includeStack: false });
    activeRuntime.widelog.flush();
  });
};

const initializeWideLogger = (options: Partial<WideloggerOptions> = {}): void => {
  const nextConfig: LoggerConfig = {
    ...getDefaultLoggerConfig(),
    ...options,
    defaultEventName: options.defaultEventName ?? DEFAULT_EVENT_NAME,
    service: options.service ?? getDefaultServiceName(),
  };

  if (isSameConfig(activeConfig, nextConfig)) {
    return;
  }

  const previousRuntime = activeRuntime;
  activeRuntime = widelogger(nextConfig);
  activeConfig = nextConfig;

  previousRuntime.destroy().catch((error: unknown) => {
    emitRuntimeError(error, "widelog:destroy:previous");
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isWideLogPrimitive = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

const stringifyFieldValue = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const appendArrayValue = (key: string, value: unknown): void => {
  const runtime = getRuntime();
  if (isWideLogPrimitive(value)) {
    runtime.widelog.append(key, value);
    return;
  }

  if (value instanceof Date) {
    runtime.widelog.append(key, value.toISOString());
    return;
  }

  runtime.widelog.append(key, stringifyFieldValue(value));
};

const setField = (key: string, value: unknown): void => {
  const runtime = getRuntime();

  if (value === null || value === globalThis.undefined) {
    return;
  }

  if (isWideLogPrimitive(value)) {
    runtime.widelog.set(key, value);
    return;
  }

  if (value instanceof Date) {
    runtime.widelog.set(key, value.toISOString());
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      appendArrayValue(key, item);
    }
    return;
  }

  if (isRecord(value)) {
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      setField(`${key}.${nestedKey}`, nestedValue);
    }
    return;
  }

  runtime.widelog.set(key, stringifyFieldValue(value));
};

const setLogFields = (fields: Record<string, unknown>): void => {
  for (const [key, value] of Object.entries(fields)) {
    setField(key, value);
  }
};

const incrementLogCount = (key: string, amount = 1): void => {
  getRuntime().widelog.count(key, amount);
};

const getErrorDetails = (error: unknown): ErrorDetails => {
  if (error instanceof Error) {
    let constructorName = DEFAULT_ERROR_TYPE;
    if (typeof error.constructor?.name === "string" && error.constructor.name.length > 0) {
      constructorName = error.constructor.name;
    }

    return {
      errorMessage: error.message,
      errorType: constructorName,
    };
  }

  return {
    errorMessage: String(error),
    errorType: DEFAULT_ERROR_TYPE,
  };
};

const toErrorTypeFieldSegment = (errorType: string): string => {
  const normalized = errorType.replaceAll(/[^a-zA-Z0-9_]/g, "_");
  if (normalized.length === 0) {
    return DEFAULT_ERROR_TYPE;
  }
  return normalized;
};

const shouldAppendErrorMessage = (
  errorTypeSegment: string,
  errorMessage: string,
): boolean => {
  const context = contextStore.getStore();

  if (!context) {
    return true;
  }

  const seenMessages = context.seenErrorMessagesByType.get(errorTypeSegment) ?? new Set<string>();

  if (seenMessages.has(errorMessage)) {
    return false;
  }

  seenMessages.add(errorMessage);
  context.seenErrorMessagesByType.set(errorTypeSegment, seenMessages);
  return true;
};

const addErrorToCurrentContext = (error: unknown): void => {
  const runtime = getRuntime();
  const { errorMessage, errorType } = getErrorDetails(error);
  const errorTypeSegment = toErrorTypeFieldSegment(errorType);

  runtime.widelog.count("error.count", 1);
  runtime.widelog.count(`error.${errorTypeSegment}.count`, 1);
  if (shouldAppendErrorMessage(errorTypeSegment, errorMessage)) {
    runtime.widelog.append(`error.${errorTypeSegment}.messages`, errorMessage);
  }
  runtime.widelog.set("error.occurred", true);
  runtime.widelog.set("error.type", errorType);
  runtime.widelog.set("error.message", errorMessage);
  runtime.widelog.set("outcome", "error");
};

const finalizeAndFlush = (startedAtMs: number): void => {
  const endedAtMs = Date.now();
  setLogFields({
    "request.duration.ms": endedAtMs - startedAtMs,
    "request.timing.end": endedAtMs,
  });
  getRuntime().widelog.flush();
};

const runWideEvent = <TResult>(
  fields: Record<string, unknown>,
  callback: () => TResult | Promise<TResult>,
): Promise<TResult> => {
  const startedAtMs = Date.now();
  const context: WideLogContext = {
    requestId: randomUUID(),
    seenErrorMessagesByType: new Map<string, Set<string>>(),
    startedAtMs,
    timingStartsByName: new Map<string, number>(),
  };

  return getRuntime().widelog.context(() =>
    contextStore.run(context, async () => {
      setLogFields({
        "request.id": context.requestId,
        "request.timing.start": context.startedAtMs,
      });
      setLogFields(fields);

      try {
        return await callback();
      } catch (error) {
        addErrorToCurrentContext(error);
        throw error;
      } finally {
        finalizeAndFlush(startedAtMs);
      }
    }),
  );
};

const emitWideEvent = async (fields: Record<string, unknown>): Promise<void> => {
  await runWideEvent(fields, () => globalThis.undefined);
};

const reportError = (error: unknown, fields: Record<string, unknown> = {}): void => {
  if (contextStore.getStore()) {
    setLogFields(fields);
    addErrorToCurrentContext(error);
    return;
  }

  const startedAtMs = Date.now();
  const context: WideLogContext = {
    requestId: randomUUID(),
    seenErrorMessagesByType: new Map<string, Set<string>>(),
    startedAtMs,
    timingStartsByName: new Map<string, number>(),
  };

  getRuntime().widelog.context(() =>
    contextStore.run(context, () => {
      setLogFields({
        "http.status_code": ERROR_STATUS_CODE,
        "operation.name": DEFAULT_ERROR_OPERATION_NAME,
        "operation.type": "error",
        "request.id": context.requestId,
        "request.timing.start": context.startedAtMs,
        ...fields,
      });
      addErrorToCurrentContext(error);
      finalizeAndFlush(startedAtMs);
    }),
  );
};

const startTiming = (name: string): void => {
  const context = contextStore.getStore();
  if (!context) {
    return;
  }
  context.timingStartsByName.set(name, performance.now());
};

const endTiming = (name: string): number | null => {
  const context = contextStore.getStore();
  if (!context) {
    return null;
  }

  const startedAt = context.timingStartsByName.get(name);
  if (!startedAt) {
    return null;
  }

  const durationMs = Math.round(performance.now() - startedAt);
  context.timingStartsByName.delete(name);
  setLogFields({ [`timings.${name}`]: durationMs });
  return durationMs;
};

const getCurrentRequestId = (): string | null => contextStore.getStore()?.requestId ?? null;

const shutdownLogging = (): Promise<void> => getRuntime().destroy();

export {
  emitWideEvent,
  endTiming,
  getCurrentRequestId,
  incrementLogCount,
  initializeWideLogger,
  reportError,
  runWideEvent,
  setLogFields,
  shutdownLogging,
  startTiming,
};
