import { randomUUID } from "node:crypto";
import type { ServiceBoundary, WideEventFields } from "./types";

const createInitialFields = (
  serviceBoundary: ServiceBoundary
): Partial<WideEventFields> => ({
  requestId: randomUUID(),
  startTime: Date.now(),
  serviceBoundary,
  timings: {},
});

const extractErrorFields = (
  error: unknown
): Pick<WideEventFields, "error" | "errorType" | "errorMessage" | "errorCode"> => {
  if (error instanceof Error) {
    return {
      error: true,
      errorType: error.constructor.name,
      errorMessage: error.message,
      errorCode: "code" in error ? String(error.code) : undefined,
    };
  }
  return {
    error: true,
    errorType: "Unknown",
    errorMessage: String(error),
  };
};

const calculateDuration = (startTime: number, endTime: number): number =>
  endTime - startTime;

export class WideEvent {
  private fields: Partial<WideEventFields>;
  private timingStarts: Map<string, number> = new Map();

  constructor(serviceBoundary: ServiceBoundary) {
    this.fields = createInitialFields(serviceBoundary);
  }

  set = (fields: Partial<WideEventFields>): this => {
    Object.assign(this.fields, fields);
    return this;
  };

  get = <Key extends keyof WideEventFields>(
    key: Key
  ): WideEventFields[Key] | undefined => {
    return this.fields[key];
  };

  startTiming = (timingName: string): void => {
    this.timingStarts.set(timingName, performance.now());
  };

  endTiming = (timingName: string): number | undefined => {
    const timingStart = this.timingStarts.get(timingName);
    if (timingStart === undefined) return undefined;

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
    const { requestId, startTime, serviceBoundary } = this.fields;

    if (!requestId) {
      throw new Error("WideEvent requestId was not initialized");
    }
    if (startTime === undefined) {
      throw new Error("WideEvent startTime was not initialized");
    }
    if (!serviceBoundary) {
      throw new Error("WideEvent serviceBoundary was not initialized");
    }

    const endTime = Date.now();
    return {
      ...this.fields,
      requestId,
      startTime,
      serviceBoundary,
      endTime,
      durationMs: calculateDuration(startTime, endTime),
    };
  };

  getRequestId = (): string => {
    const requestId = this.fields.requestId;
    if (!requestId) {
      throw new Error("WideEvent requestId was not initialized");
    }
    return requestId;
  };
}
