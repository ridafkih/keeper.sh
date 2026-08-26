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
  /* Mirrors the run edited in place. Every provider echoes back the uid the mapping already holds
     on an ordinary update, so such a run reports `added` 0 for ever; without counting it here a
     destination that only ever needs edits looks like it never succeeds, and one permanently
     refused event would escalate the whole calendar's backoff to six hours indefinitely. */
  updated: number;
  conflictsResolved: number;
  removed: number;
  removeFailed: number;
  parked?: number;
}

/* Stated as positive evidence of success rather than as an absence of it, so a counter that never
   arrives cannot be read as a run that worked: the safe answer to a missing number is backoff. */
const hasSuccessfulOperation = (result: DestinationOperationCounts): boolean =>
  result.added > 0
  || result.updated > 0
  || result.removed > 0
  || result.conflictsResolved > 0;

/* A parked failure says nothing about the destination: it is the same one event being refused
   again, and it will be refused on every future cycle too. Counting it as evidence lets a single
   unactionable event escalate the whole calendar to the six-hour ceiling, where every other event
   on it then waits, and backoff clears only on a success a quiet calendar can never reach. */
const hasActionableFailure = (result: DestinationOperationCounts): boolean =>
  result.addFailed + result.removeFailed - (result.parked ?? 0) > 0;

const hasNoSuccessfulOperations = (result: DestinationOperationCounts): boolean =>
  !hasSuccessfulOperation(result)
  && hasActionableFailure(result);

const hasAttemptedOperations = (result: DestinationOperationCounts): boolean =>
  hasSuccessfulOperation(result)
  || hasActionableFailure(result);

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
