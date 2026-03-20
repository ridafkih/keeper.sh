import { DestinationExecutionEventType } from "@keeper.sh/state-machines";
import type { DestinationExecutionEvent } from "@keeper.sh/state-machines";
import { getErrorMessage, isBackoffEligibleError } from "./destination-errors";

enum DestinationExecutionFailureClassification {
  RETRYABLE = "retryable",
  TERMINAL = "terminal",
}

interface DestinationExecutionFailureEventMap {
  classification: DestinationExecutionFailureClassification;
  errorMessage: string;
  event:
    | Extract<
      DestinationExecutionEvent,
      { type: typeof DestinationExecutionEventType.EXECUTION_FAILED }
    >
    | Extract<
      DestinationExecutionEvent,
      { type: typeof DestinationExecutionEventType.EXECUTION_FATAL_FAILED }
    >;
}

const mapDestinationExecutionFailureEvent = (
  error: unknown,
  occurredAt: string,
): DestinationExecutionFailureEventMap => {
  const errorMessage = getErrorMessage(error);
  if (isBackoffEligibleError(error)) {
    return {
      classification: DestinationExecutionFailureClassification.RETRYABLE,
      errorMessage,
      event: {
        at: occurredAt,
        code: errorMessage,
        reason: errorMessage,
        type: DestinationExecutionEventType.EXECUTION_FAILED,
      },
    };
  }

  return {
    classification: DestinationExecutionFailureClassification.TERMINAL,
    errorMessage,
    event: {
      code: errorMessage,
      reason: errorMessage,
      type: DestinationExecutionEventType.EXECUTION_FATAL_FAILED,
    },
  };
};

export {
  DestinationExecutionFailureClassification,
  mapDestinationExecutionFailureEvent,
};
export type { DestinationExecutionFailureEventMap };
