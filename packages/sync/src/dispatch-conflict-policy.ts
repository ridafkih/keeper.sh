import type { DestinationExecutionDispatchResult } from "@keeper.sh/machine-orchestration";

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
  conflictCode: DispatchConflictCode;
  notifyCalendarFailed: (failure: CalendarSyncFailure) => Promise<void>;
}

interface BuildCalendarFailureInput {
  destination: ConflictPolicyDestination;
  startedAtMs: number;
  error: string;
  retryable: boolean;
  disabled: boolean;
}

enum DispatchConflictCode {
  LOCK_ACQUIRED = "machine_conflict_lock_acquired",
  EXECUTION_STARTED = "machine_conflict_execution_started",
  PROVIDER_RESOLUTION_FAILED = "machine_conflict_provider_resolution_failed",
  INVALIDATION_DETECTED = "machine_conflict_invalidation_detected",
  EXECUTION_SUCCEEDED = "machine_conflict_execution_succeeded",
  EXECUTION_FAILED = "machine_conflict_execution_failed",
}

const isDispatchConflictCode = (value: string): value is DispatchConflictCode =>
  value === DispatchConflictCode.LOCK_ACQUIRED
  || value === DispatchConflictCode.EXECUTION_STARTED
  || value === DispatchConflictCode.PROVIDER_RESOLUTION_FAILED
  || value === DispatchConflictCode.INVALIDATION_DETECTED
  || value === DispatchConflictCode.EXECUTION_SUCCEEDED
  || value === DispatchConflictCode.EXECUTION_FAILED;

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
  if (!isDispatchConflictCode(input.conflictCode)) {
    throw new Error(`Unknown dispatch conflict code: ${input.conflictCode}`);
  }
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

export { DispatchConflictCode, buildCalendarFailure, handleDispatchConflict };
export type { CalendarSyncFailure, ConflictPolicyDestination };
