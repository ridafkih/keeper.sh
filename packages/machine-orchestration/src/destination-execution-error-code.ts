enum DestinationExecutionErrorCode {
  RETRYABLE_FAILURE = "destination_retryable_failure",
  TERMINAL_FAILURE = "destination_terminal_failure",
}

enum DestinationExecutionFailureClassification {
  RETRYABLE = "retryable",
  TERMINAL = "terminal",
}

const destinationExecutionErrorCodeByClassification: Record<
  DestinationExecutionFailureClassification,
  DestinationExecutionErrorCode
> = {
  [DestinationExecutionFailureClassification.RETRYABLE]: DestinationExecutionErrorCode.RETRYABLE_FAILURE,
  [DestinationExecutionFailureClassification.TERMINAL]: DestinationExecutionErrorCode.TERMINAL_FAILURE,
};

const mapDestinationFailureClassificationToErrorCode = (
  classification: DestinationExecutionFailureClassification,
): DestinationExecutionErrorCode => destinationExecutionErrorCodeByClassification[classification];

export {
  DestinationExecutionErrorCode,
  DestinationExecutionFailureClassification,
  mapDestinationFailureClassificationToErrorCode,
};
