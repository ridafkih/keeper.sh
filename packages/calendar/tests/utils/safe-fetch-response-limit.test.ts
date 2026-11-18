import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { isTimeoutError } from "../../src/core/utils/fetch-with-timeout";
import {
  createSafeFetch,
  DEFAULT_MAX_RESPONSE_BYTES,
  ResponseTooLargeError,
} from "../../src/utils/safe-fetch";
import { createEndlessGzipBody, startRemoteBodyServer } from "./remote-body-server";

const MEBIBYTE = 1024 * 1024;
const LIMIT_BYTES = 2 * MEBIBYTE;
const STALL_TIMEOUT_MS = 150;
const PADDING_BLOCK = Buffer.alloc(MEBIBYTE, "A");
const SMALL_BODY = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
const COMPRESSIBLE_BODY = Buffer.alloc(LIMIT_BYTES * 4, "A");

const endless = createEndlessGzipBody(PADDING_BLOCK, { "content-type": "text/calendar" });
const endlessUnderDefault = createEndlessGzipBody(PADDING_BLOCK, { "content-type": "text/calendar" });

const captureRejection = async (operation: Promise<unknown>): Promise<unknown> => {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the operation to reject");
};

const server = await startRemoteBodyServer({
  "/compressed-once": (_request, response) => {
    const compressed = gzipSync(COMPRESSIBLE_BODY);
    response.writeHead(200, {
      "content-encoding": "gzip",
      "content-length": String(compressed.byteLength),
    });
    response.end(compressed);
  },
  "/declared-oversized": (_request, response) => {
    response.writeHead(200, { "content-length": String(LIMIT_BYTES + 1) });
    response.write("BEGIN:VCALENDAR\r\n");
  },
  "/endless": endless.handler,
  "/endless-default": endlessUnderDefault.handler,
  "/small": (_request, response) => {
    const compressed = gzipSync(SMALL_BODY);
    response.writeHead(200, { "content-encoding": "gzip" });
    response.end(compressed);
  },
  "/stalled": (_request, response) => {
    response.writeHead(200, { "content-type": "text/calendar" });
    response.write("BEGIN:VCALENDAR\r\n");
  },
});

afterAll(async () => {
  await server.close();
});

describe("createSafeFetch response size limit", () => {
  it("returns a compressed body that decompresses within the limit", async () => {
    const safeFetch = createSafeFetch({ maxResponseBytes: LIMIT_BYTES });

    const response = await safeFetch(server.url("/small"));

    await expect(response.text()).resolves.toBe(SMALL_BODY);
  });

  it("counts decompressed bytes, not the bytes sent over the wire", async () => {
    const safeFetch = createSafeFetch({ maxResponseBytes: LIMIT_BYTES });

    const response = await safeFetch(server.url("/compressed-once"));
    const wireBytes = Number(response.headers.get("content-length"));
    const error = await captureRejection(response.text());

    expect(wireBytes).toBeLessThan(LIMIT_BYTES);
    expect(error).toBeInstanceOf(ResponseTooLargeError);
  });

  it("stops a compressed body that never ends and hangs up on the server", async () => {
    const safeFetch = createSafeFetch({ maxResponseBytes: LIMIT_BYTES });

    const response = await safeFetch(server.url("/endless"));
    const error = await captureRejection(response.text());
    await endless.tracker.hungUp;

    expect(error).toBeInstanceOf(ResponseTooLargeError);
    expect(endless.tracker.uncompressedBytes()).toBeGreaterThan(LIMIT_BYTES);
  });

  it("keeps memory bounded while a never-ending compressed body is refused by default", async () => {
    const safeFetch = createSafeFetch();
    const residentBefore = process.memoryUsage().rss;

    const response = await safeFetch(server.url("/endless-default"));
    const error = await captureRejection(response.text());
    const residentGrowth = process.memoryUsage().rss - residentBefore;
    await endlessUnderDefault.tracker.hungUp;

    expect(error).toMatchObject({ limitBytes: DEFAULT_MAX_RESPONSE_BYTES });
    expect(residentGrowth).toBeLessThan(DEFAULT_MAX_RESPONSE_BYTES * 4);
  });

  it("refuses a declared length over the limit without waiting for the body", async () => {
    const safeFetch = createSafeFetch({ maxResponseBytes: LIMIT_BYTES });

    const response = await safeFetch(server.url("/declared-oversized"));
    const error = await captureRejection(response.text());

    expect(error).toBeInstanceOf(ResponseTooLargeError);
  });

  it("still reports a timeout when the body stalls before the limit", async () => {
    const safeFetch = createSafeFetch({ maxResponseBytes: LIMIT_BYTES, timeoutMs: STALL_TIMEOUT_MS });

    const response = await safeFetch(server.url("/stalled"));
    const error = await captureRejection(response.text());

    expect(isTimeoutError(error)).toBe(true);
  });

  it("still aborts the body read when the caller's signal fires", async () => {
    const controller = new AbortController();
    const safeFetch = createSafeFetch({ maxResponseBytes: LIMIT_BYTES, signal: controller.signal });

    const response = await safeFetch(server.url("/stalled"));
    const pending = captureRejection(response.text());
    controller.abort();
    const error = await pending;

    expect(error).toMatchObject({ name: "AbortError" });
  });
});
