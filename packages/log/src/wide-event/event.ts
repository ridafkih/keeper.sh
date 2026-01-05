import type { ServiceBoundary, WideEventFields } from "./types";
import { randomUUID } from "node:crypto";

const createInitialFields = (serviceBoundary: ServiceBoundary): Partial<WideEventFields> => ({
  requestId: randomUUID(),
  serviceBoundary,
  startTime: Date.now(),
  timings: {},
});

type ErrorFields = Pick<
  WideEventFields,
  "error" | "errorType" | "errorMessage" | "errorCode" | "errorStack" | "errorCause"
>;

const formatCause = (cause: Error): string => `${cause.name}: ${cause.message}`;

const extractErrorFields = (error: unknown): ErrorFields => {
  if (!(error instanceof Error)) {
    return {
      error: true,
      errorMessage: String(error),
      errorType: "Unknown",
    };
  }

  const fields: ErrorFields = {
    error: true,
    errorMessage: error.message,
    errorStack: error.stack,
    errorType: error.constructor.name,
  };

  if ("code" in error) {
    fields.errorCode = String(error.code);
  }

  if (error.cause instanceof Error) {
    fields.errorCause = formatCause(error.cause);
  }

  return fields;
};

const calculateDuration = (startTime: number, endTime: number): number => endTime - startTime;

export class WideEvent {
  private fields: Partial<WideEventFields>;
  private timingStarts = new Map<string, number>();

  constructor(serviceBoundary: ServiceBoundary) {
    this.fields = createInitialFields(serviceBoundary);
  }

  set = (fields: Partial<WideEventFields>): this => {
    Object.assign(this.fields, fields);
    return this;
  };

  get = <Key extends keyof WideEventFields>(key: Key): WideEventFields[Key] | undefined =>
    this.fields[key];

  startTiming = (timingName: string): void => {
    this.timingStarts.set(timingName, performance.now());
  };

  endTiming = (timingName: string): number | null => {
    const timingStart = this.timingStarts.get(timingName) ?? null;

    if (timingStart === null) {
      return null;
    }

    const duration = Math.round(performance.now() - timingStart);
    this.timingStarts.delete(timingName);
    this.fields.timings = { ...this.fields.timings, [timingName]: duration };
    return duration;
  };

  setError = (error: unknown): this => {
    const errorFields = extractErrorFields(error);
    Object.assign(this.fields, errorFields);
    return this;
  };

  finalize = (): WideEventFields => {
    const { requestId, startTime = null, serviceBoundary } = this.fields;

    if (!requestId) {
      throw new Error("WideEvent requestId was not initialized");
    }
    if (startTime === null) {
      throw new Error("WideEvent startTime was not initialized");
    }
    if (!serviceBoundary) {
      throw new Error("WideEvent serviceBoundary was not initialized");
    }

    const endTime = Date.now();
    return {
      ...this.fields,
      durationMs: calculateDuration(startTime, endTime),
      endTime,
      requestId,
      serviceBoundary,
      startTime,
    };
  };

  getRequestId = (): string => {
    const { requestId } = this.fields;
    if (!requestId) {
      throw new Error("WideEvent requestId was not initialized");
    }
    return requestId;
  };
}
