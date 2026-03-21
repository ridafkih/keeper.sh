import { describe, expect, it } from "bun:test";
import { ErrorPolicy } from "@keeper.sh/state-machines";
import { RuntimeInvariantViolationError } from "./machine-runtime-driver";
import { resolveDestinationFailureOutput } from "./destination-failure-policy";

describe("resolveDestinationFailureOutput", () => {
  it("returns retryable failure policy", () => {
    const policy = resolveDestinationFailureOutput([
      {
        type: "DESTINATION_EXECUTION_FAILED",
        code: "provider-timeout",
        policy: ErrorPolicy.RETRYABLE,
      },
    ]);

    expect(policy).toEqual({
      code: "provider-timeout",
      disabled: false,
      policy: ErrorPolicy.RETRYABLE,
      retryable: true,
    });
  });

  it("returns terminal failure policy", () => {
    const policy = resolveDestinationFailureOutput([
      {
        type: "DESTINATION_EXECUTION_FAILED",
        code: "auth-failed",
        policy: ErrorPolicy.TERMINAL,
      },
    ]);

    expect(policy).toEqual({
      code: "auth-failed",
      disabled: true,
      policy: ErrorPolicy.TERMINAL,
      retryable: false,
    });
  });

  it("throws when failed output is missing", () => {
    expect(() =>
      resolveDestinationFailureOutput([
        {
          changed: false,
          type: "DESTINATION_EXECUTION_COMPLETED",
        },
      ]),
    ).toThrow(RuntimeInvariantViolationError);
    expect(() =>
      resolveDestinationFailureOutput([
        {
          changed: false,
          type: "DESTINATION_EXECUTION_COMPLETED",
        },
      ]),
    ).toThrow(expect.objectContaining({
      aggregateId: "destination-failure-policy",
      code: "DESTINATION_FAILURE_OUTPUT_COUNT_INVALID",
      surface: "destination-failure-policy",
    }));
  });

  it("throws when failed output is duplicated", () => {
    expect(() =>
      resolveDestinationFailureOutput([
        {
          type: "DESTINATION_EXECUTION_FAILED",
          code: "a",
          policy: ErrorPolicy.RETRYABLE,
        },
        {
          type: "DESTINATION_EXECUTION_FAILED",
          code: "b",
          policy: ErrorPolicy.TERMINAL,
        },
      ]),
    ).toThrow(RuntimeInvariantViolationError);
    expect(() =>
      resolveDestinationFailureOutput([
        {
          type: "DESTINATION_EXECUTION_FAILED",
          code: "a",
          policy: ErrorPolicy.RETRYABLE,
        },
        {
          type: "DESTINATION_EXECUTION_FAILED",
          code: "b",
          policy: ErrorPolicy.TERMINAL,
        },
      ]),
    ).toThrow(expect.objectContaining({
      aggregateId: "destination-failure-policy",
      code: "DESTINATION_FAILURE_OUTPUT_COUNT_INVALID",
      surface: "destination-failure-policy",
    }));
  });
});
