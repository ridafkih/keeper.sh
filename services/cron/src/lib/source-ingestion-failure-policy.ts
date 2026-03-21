import { RuntimeInvariantViolationError } from "@keeper.sh/machine-orchestration";
import { ErrorPolicy } from "@keeper.sh/state-machines";
import type {
  SourceIngestionLifecycleOutput,
} from "@keeper.sh/state-machines";
import {
  parseSourceIngestionErrorCode,
  SourceIngestionErrorCode,
} from "./source-ingestion-error-code";

interface SourceIngestionFailurePolicy {
  code: SourceIngestionErrorCode;
  policy: ErrorPolicy;
  requiresReauth: boolean;
}

interface ResolveSourceIngestionFailurePolicyInput {
  outputs: SourceIngestionLifecycleOutput[];
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

  const parsedCode = parseSourceIngestionErrorCode(failureOutput.code);
  if (!parsedCode) {
    throw new RuntimeInvariantViolationError({
      aggregateId: "source-ingestion-failure-policy",
      code: "SOURCE_INGESTION_FAILURE_CODE_INVALID",
      reason: `unknown ingestion failure code: ${failureOutput.code}`,
      surface: "source-ingestion-failure-policy",
    });
  }

  if (failureOutput.policy === ErrorPolicy.RETRYABLE) {
    return {
      code: parsedCode,
      policy: ErrorPolicy.RETRYABLE,
      requiresReauth: false,
    };
  }

  if (failureOutput.policy === ErrorPolicy.REQUIRES_REAUTH) {
    return {
      code: parsedCode,
      policy: ErrorPolicy.REQUIRES_REAUTH,
      requiresReauth: true,
    };
  }

  return {
    code: parsedCode,
    policy: ErrorPolicy.TERMINAL,
    requiresReauth: false,
  };
};

export { resolveSourceIngestionFailurePolicy };
export type {
  ResolveSourceIngestionFailurePolicyInput,
  SourceIngestionFailurePolicy,
};
