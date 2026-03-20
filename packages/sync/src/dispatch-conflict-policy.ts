import type { DestinationExecutionDispatchResult } from "./destination-execution-runtime";

interface ConflictPolicyDestination {
  accountId: string;
  calendarId: string;
  provider: string;
  userId: string;
}

interface CalendarSyncFailure {
  provider: string;
  accountId: string;
  calendarId: string;
  userId: string;
  error: string;
  durationMs: number;
  retryable: boolean;
  disabled: boolean;
}

interface HandleDispatchConflictInput {
  result: DestinationExecutionDispatchResult;
  runtime: { releaseIfHeld: () => Promise<void> };
  destination: ConflictPolicyDestination;
  startedAtMs: number;
  conflictCode: string;
  notifyCalendarFailed: (failure: CalendarSyncFailure) => Promise<void>;
}

interface BuildCalendarFailureInput {
  destination: ConflictPolicyDestination;
  startedAtMs: number;
  error: string;
  retryable: boolean;
  disabled: boolean;
}

const buildCalendarFailure = (input: BuildCalendarFailureInput): CalendarSyncFailure => ({
  provider: input.destination.provider,
  accountId: input.destination.accountId,
  calendarId: input.destination.calendarId,
  userId: input.destination.userId,
  error: input.error,
  durationMs: Date.now() - input.startedAtMs,
  retryable: input.retryable,
  disabled: input.disabled,
});

const handleDispatchConflict = async (
  input: HandleDispatchConflictInput,
): Promise<boolean> => {
  if (input.result.outcome === "TRANSITION_APPLIED") {
    return false;
  }
  await input.runtime.releaseIfHeld();
  await input.notifyCalendarFailed(
    buildCalendarFailure({
      destination: input.destination,
      startedAtMs: input.startedAtMs,
      error: input.conflictCode,
      retryable: true,
      disabled: false,
    }),
  );
  return true;
};

export { buildCalendarFailure, handleDispatchConflict };
export type { CalendarSyncFailure, ConflictPolicyDestination };
