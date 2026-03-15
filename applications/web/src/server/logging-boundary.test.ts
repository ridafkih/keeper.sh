import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { ServerConfig } from "./types";

const context = mock((callback: () => unknown) => callback());
const append = mock(() => {});
const count = mock(() => {});
const set = mock(() => {});
const setFields = mock(() => {});
const max = mock(() => {});
const min = mock(() => {});
const measure = mock((_key: string, callback: () => unknown) => callback());
const start = mock(() => {});
const stop = mock(() => {});
const errorFields = mock(() => {});
const flush = mock(() => {});
const destroy = mock(async () => {});

let emitLifecycleWideEvent: (
  operationName: string,
  outcome: "success" | "error",
  config: ServerConfig,
) => Promise<void> = async () => {};
let handleWithWideLogging: (
  request: Request,
  config: ServerConfig,
  handler: (request: Request) => Promise<Response>,
) => Promise<Response> = async () => new Response(null, { status: 500 });

beforeAll(async () => {
  mock.module("widelogger", () => ({
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
    widelogger: () => ({
      context,
      destroy,
    }),
  }));

  ({ emitLifecycleWideEvent, handleWithWideLogging } = await import(
    `./logging?test=${Date.now()}`
  ));
});

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  context.mockClear();
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
  destroy.mockClear();
});

const config: ServerConfig = {
  environment: "production",
  serverPort: 3000,
};

describe("handleWithWideLogging", () => {
  it("emits canonical success fields and flushes once", async () => {
    const response = await handleWithWideLogging(
      new Request("http://localhost/api/accounts/12345", {
        headers: {
          "user-agent": "test-agent",
          "x-request-id": "req-web-1",
        },
        method: "GET",
      }),
      config,
      async () => new Response(null, { status: 204 }),
    );

    expect(response.status).toBe(204);
    expect(context).toHaveBeenCalledTimes(1);
    expect(setFields).toHaveBeenCalledTimes(1);
    expect(setFields.mock.calls[0]?.[0]).toEqual({
      http: {
        method: "GET",
        path: "/api/accounts/12345",
      },
      operation: {
        name: "GET /api/accounts/:id",
        type: "http",
      },
      request: {
        id: "req-web-1",
      },
      server: {
        environment: "production",
        port: 3000,
      },
    });
    expect(measure).toHaveBeenCalledWith("duration_ms", expect.any(Function));
    expect(set).toHaveBeenCalledWith("status_code", 204);
    expect(set).toHaveBeenCalledWith("outcome", "success");
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("marks server errors with canonical fields", async () => {
    const response = await handleWithWideLogging(
      new Request("http://localhost/fail", { method: "POST" }),
      config,
      async () => {
        throw new Error("boom");
      },
    );

    expect(response.status).toBe(500);
    expect(set).toHaveBeenCalledWith("status_code", 500);
    expect(set).toHaveBeenCalledWith("outcome", "error");
    expect(errorFields).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});

describe("emitLifecycleWideEvent", () => {
  it("emits canonical lifecycle fields", async () => {
    await emitLifecycleWideEvent("ssr:start", "success", config);

    expect(context).toHaveBeenCalledTimes(1);
    expect(setFields).toHaveBeenCalledWith({
      duration_ms: 0,
      operation: {
        name: "ssr:start",
        type: "lifecycle",
      },
      outcome: "success",
      request: {
        id: expect.any(String),
      },
      server: {
        environment: "production",
        port: 3000,
      },
      status_code: 200,
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
