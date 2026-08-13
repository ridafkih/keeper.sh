import { widelog } from "./logging";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const recordOperationFailures = (syncEvent: Record<string, unknown>): void => {
  const operationErrors = syncEvent.operation_errors;
  if (!Array.isArray(operationErrors)) {
    return;
  }

  let samples = 0;
  for (const operationError of operationErrors) {
    widelog.error("sync.failures", operationError);
    if (!isRecord(operationError)) {
      continue;
    }

    if (typeof operationError.type === "string") {
      widelog.append("sync.failure_operations", operationError.type);
    }
    if (typeof operationError.errorType === "string") {
      widelog.append("sync.failure_error_types", operationError.errorType);
    }
    if (typeof operationError.statusCode === "number") {
      widelog.append("sync.failure_status_codes", operationError.statusCode);
    }
    if (samples < 3 && typeof operationError.error === "string") {
      let operation = "unknown";
      if (typeof operationError.type === "string") {
        operation = operationError.type;
      }
      widelog.append("sync.error_samples", `[${operation}] ${operationError.error}`.slice(0, 500));
      samples += 1;
    }
  }
};

const applySyncEventFields = (syncEvent: Record<string, unknown>): void => {
  for (const [key, value] of Object.entries(syncEvent)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      widelog.set(key, value);
    }
  }
  recordOperationFailures(syncEvent);
};

export { applySyncEventFields };
