import { DestinationExecutionEventType } from "@keeper.sh/state-machines";
import type { DestinationExecutionEvent } from "@keeper.sh/state-machines";
import { getErrorMessage, isBackoffEligibleError } from "./destination-errors";
import {
  DestinationExecutionFailureClassification,
  mapDestinationFailureClassificationToErrorCode,
} from "./destination-execution-error-code";

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
    const code = mapDestinationFailureClassificationToErrorCode(
      DestinationExecutionFailureClassification.RETRYABLE,
    );
    return {
      classification: DestinationExecutionFailureClassification.RETRYABLE,
      errorMessage,
      event: {
        at: occurredAt,
        code,
        reason: errorMessage,
        type: DestinationExecutionEventType.EXECUTION_FAILED,
      },
    };
  }

  const code = mapDestinationFailureClassificationToErrorCode(
    DestinationExecutionFailureClassification.TERMINAL,
  );
  return {
    classification: DestinationExecutionFailureClassification.TERMINAL,
    errorMessage,
    event: {
      code,
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
