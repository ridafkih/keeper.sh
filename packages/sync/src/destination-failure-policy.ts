import {
  isRetryablePolicy,
  isTerminalPolicy,
} from "@keeper.sh/state-machines";
import type { DestinationExecutionOutput } from "@keeper.sh/state-machines";
import type { ErrorPolicy } from "@keeper.sh/state-machines";
import { RuntimeInvariantViolationError } from "@keeper.sh/machine-orchestration";

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
    throw new RuntimeInvariantViolationError({
      aggregateId: "destination-failure-policy",
      code: "DESTINATION_FAILURE_OUTPUT_COUNT_INVALID",
      reason: "expected exactly one DESTINATION_EXECUTION_FAILED output",
      surface: "destination-failure-policy",
    });
  }

  const [failureOutput] = failedOutputs;
  if (!failureOutput) {
    throw new RuntimeInvariantViolationError({
      aggregateId: "destination-failure-policy",
      code: "DESTINATION_FAILURE_OUTPUT_MISSING",
      reason: "missing DESTINATION_EXECUTION_FAILED output",
      surface: "destination-failure-policy",
    });
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
