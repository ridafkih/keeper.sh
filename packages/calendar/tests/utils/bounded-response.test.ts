import { describe, expect, it } from "vitest";
import { limitResponseBody, ResponseTooLargeError } from "../../src/utils/bounded-response";

const LIMIT_BYTES = 1024;
const CHUNK_BYTES = 256;

interface CountedSource {
  body: ReadableStream<Uint8Array>;
  cancelled: () => boolean;
  pulls: () => number;
}

const createEndlessSource = (): CountedSource => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel: () => {
      cancelled = true;
    },
    pull: (controller) => {
      pulls += 1;
      controller.enqueue(new Uint8Array(CHUNK_BYTES));
    },
  }, { highWaterMark: 0 });
  return { body, cancelled: () => cancelled, pulls: () => pulls };
};

const captureRejection = async (operation: Promise<unknown>): Promise<unknown> => {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the operation to reject");
};

describe("limitResponseBody", () => {
  it("returns a body within the limit unchanged", async () => {
    const limited = limitResponseBody(new Response("BEGIN:VCALENDAR"), LIMIT_BYTES);

    await expect(limited.text()).resolves.toBe("BEGIN:VCALENDAR");
  });

  it("accepts a body exactly at the limit", async () => {
    const limited = limitResponseBody(new Response(new Uint8Array(LIMIT_BYTES)), LIMIT_BYTES);

    const body = await limited.arrayBuffer();
    expect(body.byteLength).toBe(LIMIT_BYTES);
  });

  it("keeps the status, headers and URL of the original response", () => {
    const original = new Response("<multistatus/>", {
      headers: { "content-type": "application/xml" },
      status: 207,
      statusText: "Multi-Status",
    });
    Object.defineProperty(original, "url", { value: "https://dav.example.com/cal/" });

    const limited = limitResponseBody(original, LIMIT_BYTES);

    expect(limited.status).toBe(207);
    expect(limited.statusText).toBe("Multi-Status");
    expect(limited.headers.get("content-type")).toBe("application/xml");
    expect(limited.url).toBe("https://dav.example.com/cal/");
  });

  it("rejects the read once the body passes the limit", async () => {
    const source = createEndlessSource();
    const limited = limitResponseBody(new Response(source.body), LIMIT_BYTES);

    const error = await captureRejection(limited.text());

    expect(error).toBeInstanceOf(ResponseTooLargeError);
    expect(error).toMatchObject({ limitBytes: LIMIT_BYTES });
  });

  it("stops reading the source as soon as the limit is passed", async () => {
    const source = createEndlessSource();
    const limited = limitResponseBody(new Response(source.body), LIMIT_BYTES);

    await captureRejection(limited.text());

    expect(source.cancelled()).toBe(true);
    expect(source.pulls() * CHUNK_BYTES).toBeLessThanOrEqual(LIMIT_BYTES + 2 * CHUNK_BYTES);
  });

  it("rejects a declared length over the limit without reading the body", async () => {
    const source = createEndlessSource();
    const original = new Response(source.body, {
      headers: { "content-length": String(LIMIT_BYTES + 1) },
    });

    const limited = limitResponseBody(original, LIMIT_BYTES);
    const error = await captureRejection(limited.text());

    expect(error).toBeInstanceOf(ResponseTooLargeError);
    expect(source.cancelled()).toBe(true);
    expect(source.pulls()).toBe(0);
  });

  it("still exposes the status of a response whose declared length is over the limit", () => {
    const original = new Response("x", {
      headers: { "content-length": String(LIMIT_BYTES + 1) },
      status: 401,
    });

    expect(limitResponseBody(original, LIMIT_BYTES).status).toBe(401);
  });

  it("ignores a declared length that is not a number", async () => {
    const original = new Response("ok", { headers: { "content-length": "many" } });

    await expect(limitResponseBody(original, LIMIT_BYTES).text()).resolves.toBe("ok");
  });

  it("passes a response without a body through untouched", () => {
    const original = new Response(null, { status: 204 });

    expect(limitResponseBody(original, LIMIT_BYTES)).toBe(original);
  });

  it("surfaces a failure of the underlying body unchanged", async () => {
    const failure = new DOMException("The operation timed out.", "TimeoutError");
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        controller.error(failure);
      },
    });

    const error = await captureRejection(limitResponseBody(new Response(body), LIMIT_BYTES).text());

    expect(error).toBe(failure);
  });

  it("releases the source when the reader gives up on the body", async () => {
    const source = createEndlessSource();
    const limited = limitResponseBody(new Response(source.body), LIMIT_BYTES);

    await limited.body?.cancel();

    expect(source.cancelled()).toBe(true);
  });

  it("does not put the limit in the message, which callers match status codes against", () => {
    expect(new ResponseTooLargeError(404_404).message).not.toMatch(/\d/u);
  });
});
