const describeCause = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
};

class RotatedTokenNotPersistedError extends Error {
  constructor(cause: unknown) {
    super(`Refreshed OAuth credential could not be persisted: ${describeCause(cause)}`, { cause });
    this.name = "RotatedTokenNotPersistedError";
  }
}

export { RotatedTokenNotPersistedError };
