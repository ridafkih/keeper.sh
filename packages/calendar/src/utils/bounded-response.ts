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

type StopTransfer = (reason: unknown) => void;

const nextMacrotask = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

interface SourceReader {
  cancel: (reason?: unknown) => Promise<void>;
  read: () => Promise<{ done: boolean; value?: Uint8Array }>;
}

interface ResponseLimit {
  maxBytes: number;
  stopTransfer: StopTransfer;
}

const createRejectedBody = (error: Error): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    pull: (controller) => {
      controller.error(error);
    },
  }, { highWaterMark: 0 });

const createCountedBody = (
  response: Response,
  { maxBytes, stopTransfer }: ResponseLimit,
): ReadableStream<Uint8Array> => {
  let reader: SourceReader | null = null;
  let receivedBytes = 0;

  const openSource = (): SourceReader | null => {
    reader ??= response.body?.getReader() ?? null;
    return reader;
  };

  const releaseSource = async (reason: unknown): Promise<void> => {
    if (!reader) {
      stopTransfer(reason);
      await response.body?.cancel(reason).catch(() => null);
      return;
    }

    await nextMacrotask();
    stopTransfer(reason);
    await reader.cancel(reason).catch(() => null);
  };

  return new ReadableStream<Uint8Array>({
    cancel: releaseSource,
    pull: async (controller) => {
      const source = openSource();
      if (!source) {
        controller.close();
        return;
      }

      const { done, value } = await source.read();
      if (done || !value) {
        controller.close();
        return;
      }

      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        const error = new ResponseTooLargeError(maxBytes);
        controller.error(error);
        await releaseSource(error);
        return;
      }

      controller.enqueue(value);
    },
  }, { highWaterMark: 0 });
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

const limitResponseBody = (response: Response, limit: ResponseLimit): Response => {
  if (NULL_BODY_STATUSES.has(response.status)) {
    return response;
  }

  const declaredLength = readDeclaredLength(response);
  if (declaredLength !== null && declaredLength > limit.maxBytes) {
    const error = new ResponseTooLargeError(limit.maxBytes);
    limit.stopTransfer(error);
    return rebuildResponse(response, createRejectedBody(error));
  }

  return rebuildResponse(response, createCountedBody(response, limit));
};

const isResponseTooLargeError = (error: unknown): boolean => {
  if (error instanceof ResponseTooLargeError) {
    return true;
  }
  return error instanceof Error && error.cause instanceof ResponseTooLargeError;
};

export type { ResponseLimit };
export {
  BYTES_PER_MEBIBYTE,
  DEFAULT_MAX_RESPONSE_BYTES,
  isResponseTooLargeError,
  limitResponseBody,
  ResponseTooLargeError,
};
