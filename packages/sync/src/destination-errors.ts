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

/**
 * A superseded run that never attempted an operation proves nothing about the
 * destination, so it must neither escalate nor clear the backoff. Escalating
 * would punish a healthy destination for a busy worker; clearing would let a
 * broken one oscillate between failureCount 1 and 0 forever.
 */
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

export {
  BACKOFF_ERROR_PATTERNS,
  getErrorMessage,
  hasNoSuccessfulOperations,
  isBackoffEligibleError,
  resolveDestinationAttemptVerdict,
};
export type { DestinationAttemptVerdict, DestinationOperationCounts };
