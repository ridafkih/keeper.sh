interface TalliedOperationError {
  type: string;
  errorType?: string;
  reason?: string;
  statusCode?: number;
}

const OPERATION_ERROR_TALLY_PREFIX = "operation_errors";

const toTallyKeys = (operationError: TalliedOperationError): string[] => {
  const prefix = `${OPERATION_ERROR_TALLY_PREFIX}.${operationError.type}`;
  return [
    `${prefix}.status.${operationError.statusCode ?? "none"}`,
    `${prefix}.error_type.${operationError.errorType ?? "unknown"}`,
    `${prefix}.reason.${operationError.reason ?? "unspecified"}`,
  ];
};

const tallyOperationErrors = (errors: TalliedOperationError[]): Map<string, number> => {
  const tallies = new Map<string, number>();
  for (const operationError of errors) {
    for (const key of toTallyKeys(operationError)) {
      tallies.set(key, (tallies.get(key) ?? 0) + 1);
    }
  }
  return tallies;
};

const appendOperationErrorTallies = (
  wideEvent: Record<string, unknown>,
  errors: TalliedOperationError[],
): void => {
  for (const [key, count] of tallyOperationErrors(errors)) {
    wideEvent[key] = count;
  }
};

export { appendOperationErrorTallies, tallyOperationErrors };
export type { TalliedOperationError };
