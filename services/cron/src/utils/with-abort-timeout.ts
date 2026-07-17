class OperationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Source ingestion timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

const withAbortTimeout = async <TResult>(
  operation: (signal: AbortSignal, deadlineAt: number) => Promise<TResult>,
  timeoutMs: number,
): Promise<TResult> => {
  const controller = new AbortController();
  const timeoutError = new OperationTimeoutError(timeoutMs);
  const deadlineAt = Date.now() + timeoutMs;
  const timeout = setTimeout(() => controller.abort(timeoutError), timeoutMs);

  try {
    const result = await operation(controller.signal, deadlineAt);
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

export { OperationTimeoutError, withAbortTimeout };
