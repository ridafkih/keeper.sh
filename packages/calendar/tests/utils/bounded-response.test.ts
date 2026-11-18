import { describe, expect, it, vi } from "vitest";
import { limitResponseBody, ResponseTooLargeError } from "../../src/utils/bounded-response";

const LIMIT_BYTES = 1024;
const CHUNK_BYTES = 256;

interface Limit {
  maxBytes: number;
  stopTransfer: (reason: unknown) => void;
  stops: unknown[];
}

const createLimit = (): Limit => {
  const stops: unknown[] = [];
  return {
    maxBytes: LIMIT_BYTES,
    stopTransfer: (reason) => {
      stops.push(reason);
    },
    stops,
  };
};

const settle = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 20);
  });

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
    const limited = limitResponseBody(new Response("BEGIN:VCALENDAR"), createLimit());

    await expect(limited.text()).resolves.toBe("BEGIN:VCALENDAR");
  });

  it("accepts a body exactly at the limit", async () => {
    const limited = limitResponseBody(new Response(new Uint8Array(LIMIT_BYTES)), createLimit());

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

    const limited = limitResponseBody(original, createLimit());

    expect(limited.status).toBe(207);
    expect(limited.statusText).toBe("Multi-Status");
    expect(limited.headers.get("content-type")).toBe("application/xml");
    expect(limited.url).toBe("https://dav.example.com/cal/");
  });

  it("rejects the read once the body passes the limit", async () => {
    const source = createEndlessSource();
    const limited = limitResponseBody(new Response(source.body), createLimit());

    const error = await captureRejection(limited.text());

    expect(error).toBeInstanceOf(ResponseTooLargeError);
    expect(error).toMatchObject({ limitBytes: LIMIT_BYTES });
  });

  it("stops reading the source as soon as the limit is passed", async () => {
    const source = createEndlessSource();
    const limited = limitResponseBody(new Response(source.body), createLimit());

    await captureRejection(limited.text());
    await vi.waitFor(() => expect(source.cancelled()).toBe(true));

    expect(source.pulls() * CHUNK_BYTES).toBeLessThanOrEqual(LIMIT_BYTES + 2 * CHUNK_BYTES);
  });

  it("stops the transfer itself once the limit is passed", async () => {
    const limit = createLimit();
    const limited = limitResponseBody(new Response(createEndlessSource().body), limit);

    const error = await captureRejection(limited.text());
    await vi.waitFor(() => expect(limit.stops).toHaveLength(1));

    expect(limit.stops).toEqual([error]);
  });

  it("leaves the source untouched until the body is read", async () => {
    const source = createEndlessSource();
    const limit = createLimit();

    limitResponseBody(new Response(source.body), limit);
    await settle();

    expect(source.pulls()).toBe(0);
    expect(source.cancelled()).toBe(false);
    expect(limit.stops).toEqual([]);
  });

  it("does not stop the transfer of a body within the limit", async () => {
    const limit = createLimit();

    await limitResponseBody(new Response("BEGIN:VCALENDAR"), limit).text();

    expect(limit.stops).toEqual([]);
  });

  it("rejects a declared length over the limit without reading the body", async () => {
    const source = createEndlessSource();
    const limit = createLimit();
    const original = new Response(source.body, {
      headers: { "content-length": String(LIMIT_BYTES + 1) },
    });

    const limited = limitResponseBody(original, limit);
    const error = await captureRejection(limited.text());

    expect(error).toBeInstanceOf(ResponseTooLargeError);
    expect(source.pulls()).toBe(0);
    expect(limit.stops).toEqual([error]);
  });

  it("still exposes the status of a response whose declared length is over the limit", () => {
    const original = new Response("x", {
      headers: { "content-length": String(LIMIT_BYTES + 1) },
      status: 401,
    });

    expect(limitResponseBody(original, createLimit()).status).toBe(401);
  });

  it("ignores a declared length that is not a number", async () => {
    const original = new Response("ok", { headers: { "content-length": "many" } });

    await expect(limitResponseBody(original, createLimit()).text()).resolves.toBe("ok");
  });

  it("passes a response that cannot carry a body through untouched", () => {
    const original = new Response(null, { status: 204 });

    expect(limitResponseBody(original, createLimit())).toBe(original);
  });

  it("reads a response without a body as empty", async () => {
    const limited = limitResponseBody(new Response(null, { status: 200 }), createLimit());

    await expect(limited.text()).resolves.toBe("");
  });

  it("surfaces a failure of the underlying body unchanged", async () => {
    const failure = new DOMException("The operation timed out.", "TimeoutError");
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        controller.error(failure);
      },
    });

    const error = await captureRejection(limitResponseBody(new Response(body), createLimit()).text());

    expect(error).toBe(failure);
  });

  it("releases an unread source and stops the transfer when the reader gives up", async () => {
    const source = createEndlessSource();
    const limit = createLimit();
    const limited = limitResponseBody(new Response(source.body), limit);

    await limited.body?.cancel();

    expect(source.cancelled()).toBe(true);
    expect(source.pulls()).toBe(0);
    expect(limit.stops).toHaveLength(1);
  });

  it("releases a partly read source and stops the transfer when the reader gives up", async () => {
    const source = createEndlessSource();
    const limit = createLimit();
    const reader = limitResponseBody(new Response(source.body), limit).body?.getReader();

    await reader?.read();
    await reader?.cancel();

    expect(source.cancelled()).toBe(true);
    expect(limit.stops).toHaveLength(1);
  });

  it("does not put the limit in the message, which callers match status codes against", () => {
    expect(new ResponseTooLargeError(404_404).message).not.toMatch(/\d/u);
  });
});
