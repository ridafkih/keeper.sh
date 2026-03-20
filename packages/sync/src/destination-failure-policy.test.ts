import { describe, expect, it } from "bun:test";
import { resolveDestinationFailureOutput } from "./destination-failure-policy";

describe("resolveDestinationFailureOutput", () => {
  it("returns retryable failure policy", () => {
    const policy = resolveDestinationFailureOutput([
      {
        type: "DESTINATION_EXECUTION_FAILED",
        code: "provider-timeout",
        retryable: true,
      },
    ]);

    expect(policy).toEqual({
      code: "provider-timeout",
      disabled: false,
      retryable: true,
    });
  });

  it("returns terminal failure policy", () => {
    const policy = resolveDestinationFailureOutput([
      {
        type: "DESTINATION_EXECUTION_FAILED",
        code: "auth-failed",
        retryable: false,
      },
    ]);

    expect(policy).toEqual({
      code: "auth-failed",
      disabled: true,
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
          retryable: true,
        },
        {
          type: "DESTINATION_EXECUTION_FAILED",
          code: "b",
          retryable: false,
        },
      ]),
    ).toThrow("Invariant violated: expected exactly one DESTINATION_EXECUTION_FAILED output");
  });
});
