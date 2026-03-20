import { describe, expect, it } from "bun:test";
import { ErrorPolicy } from "@keeper.sh/state-machines";
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
    ).toThrow("Invariant violated: expected exactly one DESTINATION_EXECUTION_FAILED output");
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
    ).toThrow("Invariant violated: expected exactly one DESTINATION_EXECUTION_FAILED output");
  });
});
