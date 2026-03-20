import {
  isRetryablePolicy,
  isTerminalPolicy,
} from "@keeper.sh/state-machines";
import type { DestinationExecutionOutput } from "@keeper.sh/state-machines";
import type { ErrorPolicy } from "@keeper.sh/state-machines";

interface DestinationFailurePolicy {
  code: string;
  disabled: boolean;
  policy: ErrorPolicy;
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

  const { code, policy } = failureOutput;
  return {
    code,
    policy,
    disabled: isTerminalPolicy(policy),
    retryable: isRetryablePolicy(policy),
  };
};

export { resolveDestinationFailureOutput };
export type { DestinationFailurePolicy };
