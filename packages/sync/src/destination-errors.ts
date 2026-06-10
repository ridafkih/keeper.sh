/**
 * Patterns that indicate a destination calendar is fundamentally
 * broken and should be backed off with exponential delay.
 *
 * Add new patterns here as they are observed in production logs.
 */
const BACKOFF_ERROR_PATTERNS: string[] = [
  "Invalid credentials",
  "404 Not Found",
  "cannot find homeUrl",
];

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const isBackoffEligibleError = (error: unknown): boolean => {
  const message = getErrorMessage(error);

  for (const pattern of BACKOFF_ERROR_PATTERNS) {
    if (message.includes(pattern)) {
      return true;
    }
  }

  return false;
};

export { getErrorMessage, isBackoffEligibleError, BACKOFF_ERROR_PATTERNS };
