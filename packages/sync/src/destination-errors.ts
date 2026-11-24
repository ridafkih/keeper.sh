import { RecurrenceMaterializationLimitError, RequestTimeoutError } from "@keeper.sh/calendar";
import { isGoogleWriteAccessDeniedError } from "@keeper.sh/calendar/google";
import { isDatabaseError } from "@keeper.sh/database";
import { DESTINATION_BACKOFF_FAILURE_SHARE } from "@keeper.sh/constants";

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

  if (error instanceof RequestTimeoutError) {
    return true;
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
  writeAccessDenied: boolean;
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

type DestinationAttemptVerdict = "failed" | "inconclusive" | "not_writable" | "succeeded";

const resolveFailureShare = (result: DestinationOperationCounts): number => {
  const failed = result.addFailed + result.removeFailed;
  const attempted = failed + result.added + result.removed + result.conflictsResolved;
  if (attempted === 0) {
    return 0;
  }
  return failed / attempted;
};

const isMostlyFailing = (result: DestinationOperationCounts, failureShare: number): boolean =>
  resolveFailureShare(result) >= failureShare;

// Escalating an unattempted run punishes a healthy destination; clearing lets a broken one oscillate between failureCount 1 and 0 forever.
const resolveDestinationAttemptVerdict = (
  result: DestinationOperationCounts,
  superseded: boolean,
  failureShare: number = DESTINATION_BACKOFF_FAILURE_SHARE,
): DestinationAttemptVerdict => {
  if (superseded && !hasAttemptedOperations(result)) {
    return "inconclusive";
  }
  if (!hasNoSuccessfulOperations(result) && !isMostlyFailing(result, failureShare)) {
    return "succeeded";
  }
  if (result.writeAccessDenied && hasNoSuccessfulOperations(result)) {
    return "not_writable";
  }
  return "failed";
};

const resolveThrownDestinationVerdict = (error: unknown): DestinationAttemptVerdict => {
  if (isGoogleWriteAccessDeniedError(error)) {
    return "not_writable";
  }
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
