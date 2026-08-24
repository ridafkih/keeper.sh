import { RecurrenceMaterializationLimitError } from "@keeper.sh/calendar";
import { isDatabaseError } from "@keeper.sh/database";

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
  if (error instanceof RecurrenceMaterializationLimitError) {
    return true;
  }

  // A query error's message inlines the SQL and its bound parameters, so customer data can match the patterns below.
  if (isDatabaseError(error)) {
    return false;
  }

  const message = getErrorMessage(error);

  for (const pattern of BACKOFF_ERROR_PATTERNS) {
    if (message.includes(pattern)) {
      return true;
    }
  }

  return false;
};

interface DestinationOperationCounts {
  added: number;
  addFailed: number;
  conflictsResolved: number;
  removed: number;
  removeFailed: number;
}

const hasNoSuccessfulOperations = (result: DestinationOperationCounts): boolean =>
  result.added === 0
  && result.removed === 0
  && result.conflictsResolved === 0
  && result.addFailed + result.removeFailed > 0;

const hasAttemptedOperations = (result: DestinationOperationCounts): boolean =>
  result.added
  + result.removed
  + result.conflictsResolved
  + result.addFailed
  + result.removeFailed > 0;

type DestinationAttemptVerdict = "failed" | "inconclusive" | "succeeded";

// Escalating an unattempted run punishes a healthy destination; clearing lets a broken one oscillate between failureCount 1 and 0 forever.
const resolveDestinationAttemptVerdict = (
  result: DestinationOperationCounts,
  superseded: boolean,
): DestinationAttemptVerdict => {
  if (superseded && !hasAttemptedOperations(result)) {
    return "inconclusive";
  }
  if (hasNoSuccessfulOperations(result)) {
    return "failed";
  }
  return "succeeded";
};

const resolveThrownDestinationVerdict = (error: unknown): DestinationAttemptVerdict => {
  if (isBackoffEligibleError(error)) {
    return "failed";
  }
  return "inconclusive";
};

export {
  BACKOFF_ERROR_PATTERNS,
  getErrorMessage,
  hasNoSuccessfulOperations,
  isBackoffEligibleError,
  resolveDestinationAttemptVerdict,
  resolveThrownDestinationVerdict,
};
export type { DestinationAttemptVerdict, DestinationOperationCounts };
