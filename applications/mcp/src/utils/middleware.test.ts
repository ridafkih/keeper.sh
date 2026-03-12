import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { RouteHandler } from "./middleware";

const runMcpWideEventContext = mock((callback: () => unknown) => callback());
const setWideEventFields = mock((_fields: Record<string, unknown>) => {});
const trackStatusError = mock(() => {});
const set = mock(() => {});
const timeMeasure = mock(
  async (_key: string, callback: () => unknown | Promise<unknown>) => await callback(),
);
const errorFields = mock(() => {});
const flush = mock(() => {});

let withWideEvent: (handler: RouteHandler) => RouteHandler = (handler) => handler;

beforeAll(async () => {
  mock.module("./logging", () => ({
    runMcpWideEventContext,
    setWideEventFields,
    trackStatusError,
    widelog: {
      errorFields,
      flush,
      set,
      time: {
        measure: timeMeasure,
      },
    },
  }));

  ({ withWideEvent } = await import("./middleware"));
});

beforeEach(() => {
  runMcpWideEventContext.mockClear();
  setWideEventFields.mockClear();
  trackStatusError.mockClear();
  set.mockClear();
  timeMeasure.mockClear();
  errorFields.mockClear();
  flush.mockClear();
});

describe("withWideEvent", () => {
  it("records canonical success fields and flushes once", async () => {
    const wrapped = withWideEvent(() => new Response(null, { status: 204 }));

    const response = await wrapped(
      new Request("http://localhost/mcp", {
        headers: { "x-request-id": "req-1" },
        method: "GET",
      }),
    );

    expect(response.status).toBe(204);
    expect(runMcpWideEventContext).toHaveBeenCalledTimes(1);
    expect(setWideEventFields).toHaveBeenCalledTimes(1);
    expect(setWideEventFields.mock.calls[0]?.[0]).toEqual({
      http: {
        method: "GET",
        path: "/mcp",
      },
      operation: {
        name: "GET /mcp",
        type: "http",
      },
      request: {
        id: "req-1",
      },
    });
    expect(timeMeasure).toHaveBeenCalledWith("duration_ms", expect.any(Function));
    expect(set).toHaveBeenCalledWith("status_code", 204);
    expect(set).toHaveBeenCalledWith("outcome", "success");
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("marks error outcome and rethrows handler errors", async () => {
    const wrapped = withWideEvent(() => {
      throw new Error("boom");
    });

    await expect(
      wrapped(
        new Request("http://localhost/mcp", {
          headers: { "x-request-id": "req-2" },
          method: "POST",
        }),
      ),
    ).rejects.toThrow("boom");

    expect(set).toHaveBeenCalledWith("status_code", 500);
    expect(set).toHaveBeenCalledWith("outcome", "error");
    expect(errorFields).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("tracks HTTP error responses with canonical status", async () => {
    const wrapped = withWideEvent(() => new Response(null, { status: 404 }));

    const response = await wrapped(new Request("http://localhost/mcp", { method: "DELETE" }));

    expect(response.status).toBe(404);
    expect(set).toHaveBeenCalledWith("status_code", 404);
    expect(set).toHaveBeenCalledWith("outcome", "error");
    expect(trackStatusError).toHaveBeenCalledWith(404, "HttpError");
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
