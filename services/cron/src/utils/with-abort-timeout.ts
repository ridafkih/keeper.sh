class OperationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Source ingestion timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

const raceAbortSignal = <TResult>(
  signal: AbortSignal,
  operation: Promise<TResult>,
): Promise<TResult> => {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }

  const listenerScope = new AbortController();
  const aborted = new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
      signal: listenerScope.signal,
    });
  });

  return Promise.race([operation, aborted])
    .finally(() => listenerScope.abort());
};

const withAbortTimeout = async <TResult>(
  operation: (signal: AbortSignal, deadlineAt: number) => Promise<TResult>,
  timeoutMs: number,
): Promise<TResult> => {
  const controller = new AbortController();
  const timeoutError = new OperationTimeoutError(timeoutMs);
  const deadlineAt = Date.now() + timeoutMs;
  const timeout = setTimeout(() => controller.abort(timeoutError), timeoutMs);

  try {
    /*
     * Race the operation against the abort signal so a non-signal-aware hang
     * still settles at the deadline instead of stranding the scheduler slot.
     */
    const result = await raceAbortSignal(
      controller.signal,
      operation(controller.signal, deadlineAt),
    );
    if (controller.signal.aborted) {
      throw controller.signal.reason;
    }
    return result;
  } catch (error) {
    if (controller.signal.aborted) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export { OperationTimeoutError, raceAbortSignal, withAbortTimeout };
