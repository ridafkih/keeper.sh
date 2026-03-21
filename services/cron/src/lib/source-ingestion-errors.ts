const NOT_FOUND_STATUS_CODE = 404;

class SourceIngestionTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Source ingestion timed out after ${timeoutMs}ms`);
    this.name = "SourceIngestionTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

class SourceIngestionNotFoundError extends Error {
  readonly status: number;

  constructor(message = "Source ingestion target not found") {
    super(message);
    this.name = "SourceIngestionNotFoundError";
    this.status = NOT_FOUND_STATUS_CODE;
  }
}

const hasNotFoundStatus = (error: unknown): boolean =>
  typeof error === "object"
  && error !== null
  && "status" in error
  && error.status === NOT_FOUND_STATUS_CODE;

const isSourceIngestionTimeoutError = (error: unknown): error is SourceIngestionTimeoutError =>
  error instanceof SourceIngestionTimeoutError;

const isSourceIngestionNotFoundError = (error: unknown): boolean =>
  error instanceof SourceIngestionNotFoundError || hasNotFoundStatus(error);

export {
  SourceIngestionNotFoundError,
  SourceIngestionTimeoutError,
  isSourceIngestionNotFoundError,
  isSourceIngestionTimeoutError,
};
