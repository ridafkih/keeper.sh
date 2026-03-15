import { describe, expect, it } from "bun:test";
import { isAuthError } from "./errors";

describe("isAuthError", () => {
  it("returns true for unauthenticated 401 responses", () => {
    expect(isAuthError(401, { status: "UNAUTHENTICATED" })).toBe(true);
  });

  it("returns false for generic permission denied responses", () => {
    expect(
      isAuthError(403, {
        message: "The caller does not have permission",
        status: "PERMISSION_DENIED",
      }),
    ).toBe(false);
  });

  it("returns true for legacy insufficientPermissions reasons", () => {
    expect(
      isAuthError(403, {
        status: "PERMISSION_DENIED",
        errors: [{ reason: "insufficientPermissions" }],
      }),
    ).toBe(true);
  });

  it("returns true for google rpc ACCESS_TOKEN_SCOPE_INSUFFICIENT reasons", () => {
    expect(
      isAuthError(403, {
        status: "PERMISSION_DENIED",
        details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
      }),
    ).toBe(true);
  });
});
