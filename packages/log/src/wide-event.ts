import { randomUUID } from "node:crypto";
import type { ServiceBoundary, WideEventFields } from "./wide-event-types";

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
    return this.fields[key] as WideEventFields[Key] | undefined;
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
    const endTime = Date.now();
    const startTime = this.fields.startTime ?? endTime;
    return {
      ...this.fields,
      endTime,
      durationMs: calculateDuration(startTime, endTime),
    } as WideEventFields;
  };

  getRequestId = (): string => this.fields.requestId!;
}
