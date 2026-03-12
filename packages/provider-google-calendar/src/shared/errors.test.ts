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

  it("returns true for insufficient authentication scopes", () => {
    expect(
      isAuthError(403, {
        message: "Request had insufficient authentication scopes.",
        status: "PERMISSION_DENIED",
      }),
    ).toBe(true);
  });
});
