class RequestTimeoutError extends Error {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Request timeout after ${timeoutMs}ms`);
    this.name = "RequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

interface TimeoutSignal {
  signal: AbortSignal;
  isTimeout: () => boolean;
}

const mergeAbortSignals = (...signals: (AbortSignal | null | undefined)[]): AbortSignal =>
  AbortSignal.any(
    signals.flatMap((signal) => {
      if (signal) {
        return [signal];
      }
      return [];
    }),
  );

const buildTimeoutSignal = (timeoutMs: number, externalSignal?: AbortSignal | null): TimeoutSignal => {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return {
    signal: mergeAbortSignals(timeoutSignal, externalSignal),
    isTimeout: () => timeoutSignal.aborted,
  };
};

const fetchWithTimeout = async (
  input: string | URL | Request,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> => {
  const { signal, isTimeout } = buildTimeoutSignal(timeoutMs, externalSignal);
  try {
    return await fetch(input, { ...init, signal });
  } catch (error) {
    if (isTimeout()) {
      throw new RequestTimeoutError(timeoutMs);
    }
    throw error;
  }
};

const isTimeoutError = (error: unknown): boolean => {
  if (error instanceof RequestTimeoutError) {
    return true;
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return true;
  }
  return error instanceof Error && error.name === "TimeoutError";
};

export { RequestTimeoutError, buildTimeoutSignal, fetchWithTimeout, isTimeoutError, mergeAbortSignals };
export type { TimeoutSignal };
