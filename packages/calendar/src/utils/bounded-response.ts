const BYTES_PER_MEBIBYTE = 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 25 * BYTES_PER_MEBIBYTE;
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

class ResponseTooLargeError extends Error {
  public readonly limitBytes: number;

  constructor(limitBytes: number) {
    super("Response body is larger than the allowed size.");
    this.name = "ResponseTooLargeError";
    this.limitBytes = limitBytes;
  }
}

const readDeclaredLength = (response: Response): number | null => {
  const declared = response.headers.get("content-length");
  if (!declared) {
    return null;
  }
  const length = Number(declared);
  if (!Number.isSafeInteger(length) || length < 0) {
    return null;
  }
  return length;
};

const createRejectedBody = (error: Error): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.error(error);
    },
  });

const createCountedBody = (
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
): ReadableStream<Uint8Array> => {
  const reader = source.getReader();
  let receivedBytes = 0;

  return new ReadableStream<Uint8Array>({
    cancel: (reason) => reader.cancel(reason),
    pull: async (controller) => {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }

      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        const error = new ResponseTooLargeError(maxBytes);
        controller.error(error);
        await reader.cancel(error);
        return;
      }

      controller.enqueue(value);
    },
  });
};

const rebuildResponse = (response: Response, body: ReadableStream<Uint8Array>): Response => {
  const rebuilt = new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
  Object.defineProperty(rebuilt, "url", { configurable: true, enumerable: true, value: response.url });
  return rebuilt;
};

const limitResponseBody = (response: Response, maxBytes: number): Response => {
  if (NULL_BODY_STATUSES.has(response.status)) {
    return response;
  }

  const source = response.body;
  if (!source) {
    return response;
  }

  const declaredLength = readDeclaredLength(response);
  if (declaredLength !== null && declaredLength > maxBytes) {
    const error = new ResponseTooLargeError(maxBytes);
    source.cancel(error).catch(() => null);
    return rebuildResponse(response, createRejectedBody(error));
  }

  return rebuildResponse(response, createCountedBody(source, maxBytes));
};

const isResponseTooLargeError = (error: unknown): boolean => {
  if (error instanceof ResponseTooLargeError) {
    return true;
  }
  return error instanceof Error && error.cause instanceof ResponseTooLargeError;
};

export {
  BYTES_PER_MEBIBYTE,
  DEFAULT_MAX_RESPONSE_BYTES,
  isResponseTooLargeError,
  limitResponseBody,
  ResponseTooLargeError,
};
