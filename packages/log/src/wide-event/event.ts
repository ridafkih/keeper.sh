import type { BaseWideEventFields } from "./types";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import pino from "pino";

const INITIAL_COUNT = 0;
const INCREMENT = 1;

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

const getErrorType = (error: unknown): string => {
  if (error instanceof Error) {
    return error.constructor.name;
  };

  return "Keeper__HardcodedUnknownError";
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const getErrorStack = (error: unknown): string | null => {
  if (error instanceof Error) {
    return error.stack ?? null;
  }

  return null;
};

const storage = new AsyncLocalStorage<WideEvent>();

class WideEvent {
  protected fields: BaseWideEventFields;
  private timingStarts = new Map<string, number>();

  constructor() {
    this.fields = {
      "request.id": randomUUID(),
      "request.timing.start": Date.now(),
      timings: {},
    };
  }

  static grasp(): WideEvent | undefined {
    return storage.getStore();
  }

  static require(): WideEvent {
    const event = storage.getStore();
    if (!event) {throw new Error("No WideEvent in current context");}
    return event;
  }

  static error(error: unknown): void {
    storage.getStore()?.addError(error);
  }

  run<Result>(callback: () => Result | Promise<Result>): Result | Promise<Result> {
    return storage.run(this, callback);
  }

  set(fields: Partial<BaseWideEventFields>): this {
    Object.assign(this.fields, fields);
    return this;
  }

  get(key: string): unknown {
    return this.fields[key];
  }

  startTiming(name: string): void {
    this.timingStarts.set(name, performance.now());
  }

  endTiming(name: string): number | null {
    const start = this.timingStarts.get(name);

    if (!start) {
      return null;
    }

    const duration = Math.round(performance.now() - start);
    this.timingStarts.delete(name);
    this.fields.timings = { ...this.fields.timings, [name]: duration };
    return duration;
  }

  setTiming(name: string, durationMs: number): this {
    this.fields.timings = { ...this.fields.timings, [name]: durationMs };
    return this;
  }

  addError(error: unknown): this {
    const errorType = getErrorType(error);
    const countKey = `error.${errorType}.count`;
    const messageKey = `error.${errorType}.lastMessage`;
    const stackKey = `error.${errorType}.lastStack`;

    const currentCount = Number(this.fields?.[countKey] ?? INITIAL_COUNT);

    this.fields[countKey] = currentCount + INCREMENT;
    this.fields[messageKey] = getErrorMessage(error);

    const stack = getErrorStack(error);
    if (stack) {
      this.fields[stackKey] = stack;
    }

    this.fields["error.occurred"] = true;
    const errorCount = this.fields?.["error.count"] ?? INITIAL_COUNT;
    this.fields["error.count"] = errorCount + INCREMENT;

    return this;
  }

  emit(): void {
    const endTime = Date.now();
    const startTime = this.fields["request.timing.start"];

    this.fields["request.timing.end"] = endTime;
    this.fields["request.duration.ms"] = endTime - startTime;

    const operationName = String(this.fields["operation.name"] ?? "unknown");
    log.info(this.fields, operationName);
  }

  getRequestId(): string {
    return this.fields["request.id"];
  }
}

export { WideEvent, log };
