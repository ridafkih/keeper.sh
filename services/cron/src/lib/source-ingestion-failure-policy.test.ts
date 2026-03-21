import { describe, expect, test } from "bun:test";
import { RuntimeInvariantViolationError } from "@keeper.sh/machine-orchestration";
import { ErrorPolicy } from "@keeper.sh/state-machines";
import { SourceIngestionErrorCode } from "./source-ingestion-error-code";
import { resolveSourceIngestionFailurePolicy } from "./source-ingestion-failure-policy";

describe("resolveSourceIngestionFailurePolicy", () => {
  test("returns retryable policy for retryable failure output", () => {
    const policy = resolveSourceIngestionFailurePolicy({
      outputs: [{ code: "transient_failure", retryable: true, type: "INGEST_FAILED" }],
      state: "transient_error",
    });

    expect(policy).toEqual({
      code: SourceIngestionErrorCode.TRANSIENT_FAILURE,
      policy: ErrorPolicy.RETRYABLE,
      retryable: true,
      requiresReauth: false,
    });
  });

  test("returns requires reauth policy for auth_blocked state", () => {
    const policy = resolveSourceIngestionFailurePolicy({
      outputs: [{ code: "auth_required", retryable: false, type: "INGEST_FAILED" }],
      state: "auth_blocked",
    });

    expect(policy).toEqual({
      code: SourceIngestionErrorCode.AUTH_REQUIRED,
      policy: ErrorPolicy.REQUIRES_REAUTH,
      retryable: false,
      requiresReauth: true,
    });
  });

  test("returns terminal policy for non-retryable non-reauth states", () => {
    const policy = resolveSourceIngestionFailurePolicy({
      outputs: [{ code: "not_found", retryable: false, type: "INGEST_FAILED" }],
      state: "not_found_disabled",
    });

    expect(policy).toEqual({
      code: SourceIngestionErrorCode.NOT_FOUND,
      policy: ErrorPolicy.TERMINAL,
      retryable: false,
      requiresReauth: false,
    });
  });

  test("fails fast when failure output count is invalid", () => {
    expect(() =>
      resolveSourceIngestionFailurePolicy({
        outputs: [],
        state: "transient_error",
      })).toThrow(RuntimeInvariantViolationError);
  });

  test("fails fast when failure code is unknown", () => {
    expect(() =>
      resolveSourceIngestionFailurePolicy({
        outputs: [{ code: "mystery", retryable: false, type: "INGEST_FAILED" }],
        state: "not_found_disabled",
      })).toThrow(RuntimeInvariantViolationError);
  });
});
