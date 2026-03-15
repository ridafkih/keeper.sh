import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { CronOptions } from "cronbake";

const runCronWideEventContext = mock((callback: () => unknown) => callback());
const append = mock(() => 0);
const count = mock(() => 0);
const set = mock(() => 0);
const setFields = mock((_fields: Record<string, unknown>) => 0);
const max = mock(() => 0);
const min = mock(() => 0);
const measure = mock(
  (_key: string, callback: () => unknown | Promise<unknown>) => Promise.resolve(callback()),
);
const start = mock(() => 0);
const stop = mock(() => 0);
const errorFields = mock(() => 0);
const flush = mock(() => 0);

let withCronWideEvent: (options: CronOptions) => CronOptions = (options) => options;

beforeAll(async () => {
  mock.module("./logging", () => ({
    runCronWideEventContext,
    widelog: {
      append,
      count,
      errorFields,
      flush,
      max,
      min,
      set,
      setFields,
      time: {
        measure,
        start,
        stop,
      },
    },
  }));

  ({ withCronWideEvent } = await import(`./with-wide-event?test=${Date.now()}`));
});

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  runCronWideEventContext.mockClear();
  append.mockClear();
  count.mockClear();
  set.mockClear();
  setFields.mockClear();
  max.mockClear();
  min.mockClear();
  measure.mockClear();
  start.mockClear();
  stop.mockClear();
  errorFields.mockClear();
  flush.mockClear();
});

describe("withCronWideEvent", () => {
  it("records canonical success fields and flushes once", async () => {
    const wrapped = withCronWideEvent({
      callback: () => Promise.resolve(),
      cron: "@every_1_minutes",
      name: "job:sync",
    });

    await wrapped.callback();

    expect(runCronWideEventContext).toHaveBeenCalledTimes(1);
    expect(setFields).toHaveBeenCalledTimes(1);
    expect(setFields.mock.calls[0]?.[0]).toEqual({
      job: {
        name: "job:sync",
      },
      operation: {
        name: "job:sync",
        type: "job",
      },
      request: {
        id: expect.any(String),
      },
    });
    expect(measure).toHaveBeenCalledWith("duration_ms", expect.any(Function));
    expect(set).toHaveBeenCalledWith("status_code", 200);
    expect(set).toHaveBeenCalledWith("outcome", "success");
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("marks error outcome and rethrows callback errors", async () => {
    const wrapped = withCronWideEvent({
      callback: () => {
        throw new Error("job failed");
      },
      cron: "@every_1_minutes",
      name: "job:fail",
    });

    await expect(wrapped.callback()).rejects.toThrow("job failed");

    expect(set).toHaveBeenCalledWith("status_code", 500);
    expect(set).toHaveBeenCalledWith("outcome", "error");
    expect(errorFields).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
