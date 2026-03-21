import { describe, expect, it } from "bun:test";
import {
  CredentialRefreshErrorCode,
  resolveCredentialRefreshErrorCode,
} from "./credential-refresh-error-code";

describe("credential-refresh-error-code", () => {
  it("maps invalid grant errors to invalid_grant", () => {
    expect(
      resolveCredentialRefreshErrorCode(new Error("oauth invalid_grant for token refresh")),
    ).toBe(CredentialRefreshErrorCode.INVALID_GRANT);
  });

  it("maps timeout-like failures to timeout", () => {
    expect(resolveCredentialRefreshErrorCode(new Error("request timed out"))).toBe(
      CredentialRefreshErrorCode.TIMEOUT,
    );
  });

  it("returns unknown for unclassified errors", () => {
    expect(resolveCredentialRefreshErrorCode(new Error("weird provider crash"))).toBe(
      CredentialRefreshErrorCode.UNKNOWN,
    );
  });
});

