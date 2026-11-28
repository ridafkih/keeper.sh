const HTTP_UNAUTHORIZED = 401;

class CalDAVWriteRefusedError extends Error {
  constructor(cause: Error) {
    super("CalDAV server refused a write with 401, so the run stopped writing", { cause });
    this.name = "CalDAVWriteRefusedError";
  }
}

const hasUnauthorizedStatus = (error: Error): boolean =>
  "status" in error && error.status === HTTP_UNAUTHORIZED;

const findUnauthorizedFailure = (error: unknown): Error | null => {
  let candidate = error;
  const visited = new Set<unknown>();

  while (candidate instanceof Error && !visited.has(candidate)) {
    if (hasUnauthorizedStatus(candidate)) {
      return candidate;
    }
    visited.add(candidate);
    candidate = candidate.cause;
  }
  return null;
};

const createWriteAuthenticationLatch = () => {
  let refusal: Error | null = null;

  const noteFailure = (error: unknown): void => {
    refusal ??= findUnauthorizedFailure(error);
  };

  const isRefused = (): boolean => refusal !== null;

  const throwIfRefused = (): void => {
    if (refusal) {
      throw new CalDAVWriteRefusedError(refusal);
    }
  };

  return { isRefused, noteFailure, throwIfRefused };
};

export { CalDAVWriteRefusedError, createWriteAuthenticationLatch };
