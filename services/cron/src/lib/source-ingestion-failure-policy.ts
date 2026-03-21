import { RuntimeInvariantViolationError } from "@keeper.sh/machine-orchestration";
import { ErrorPolicy } from "@keeper.sh/state-machines";
import type {
  SourceIngestionLifecycleOutput,
  SourceIngestionLifecycleState,
} from "@keeper.sh/state-machines";

interface SourceIngestionFailurePolicy {
  code: string;
  policy: ErrorPolicy;
  retryable: boolean;
  requiresReauth: boolean;
}

interface ResolveSourceIngestionFailurePolicyInput {
  outputs: SourceIngestionLifecycleOutput[];
  state: SourceIngestionLifecycleState;
}

const resolveSourceIngestionFailurePolicy = (
  input: ResolveSourceIngestionFailurePolicyInput,
): SourceIngestionFailurePolicy => {
  const failedOutputs = input.outputs.filter(
    (output) => output.type === "INGEST_FAILED",
  );

  if (failedOutputs.length !== 1) {
    throw new RuntimeInvariantViolationError({
      aggregateId: "source-ingestion-failure-policy",
      code: "SOURCE_INGESTION_FAILURE_OUTPUT_COUNT_INVALID",
      reason: "expected exactly one INGEST_FAILED output",
      surface: "source-ingestion-failure-policy",
    });
  }

  const [failureOutput] = failedOutputs;
  if (!failureOutput) {
    throw new RuntimeInvariantViolationError({
      aggregateId: "source-ingestion-failure-policy",
      code: "SOURCE_INGESTION_FAILURE_OUTPUT_MISSING",
      reason: "missing INGEST_FAILED output",
      surface: "source-ingestion-failure-policy",
    });
  }

  if (failureOutput.retryable) {
    return {
      code: failureOutput.code,
      policy: ErrorPolicy.RETRYABLE,
      retryable: true,
      requiresReauth: false,
    };
  }

  if (input.state === "auth_blocked") {
    return {
      code: failureOutput.code,
      policy: ErrorPolicy.REQUIRES_REAUTH,
      retryable: false,
      requiresReauth: true,
    };
  }

  return {
    code: failureOutput.code,
    policy: ErrorPolicy.TERMINAL,
    retryable: false,
    requiresReauth: false,
  };
};

export { resolveSourceIngestionFailurePolicy };
export type {
  ResolveSourceIngestionFailurePolicyInput,
  SourceIngestionFailurePolicy,
};
