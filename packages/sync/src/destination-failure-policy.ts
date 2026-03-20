import type { DestinationExecutionOutput } from "@keeper.sh/state-machines";

interface DestinationFailurePolicy {
  code: string;
  disabled: boolean;
  retryable: boolean;
}

const resolveDestinationFailureOutput = (
  outputs: DestinationExecutionOutput[],
): DestinationFailurePolicy => {
  const failedOutputs = outputs.filter(
    (output) => output.type === "DESTINATION_EXECUTION_FAILED",
  );

  if (failedOutputs.length !== 1) {
    throw new Error(
      "Invariant violated: expected exactly one DESTINATION_EXECUTION_FAILED output",
    );
  }

  const [failureOutput] = failedOutputs;
  if (!failureOutput) {
    throw new Error(
      "Invariant violated: missing DESTINATION_EXECUTION_FAILED output",
    );
  }

  return {
    code: failureOutput.code,
    disabled: !failureOutput.retryable,
    retryable: failureOutput.retryable,
  };
};

export { resolveDestinationFailureOutput };
export type { DestinationFailurePolicy };
