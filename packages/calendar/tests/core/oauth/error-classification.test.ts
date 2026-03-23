import { describe, expect, it } from "bun:test";
import { isOAuthReauthRequiredError } from "../../../src/core/oauth/error-classification";

describe("isOAuthReauthRequiredError", () => {
  it("returns true when explicit reauth marker is true", () => {
    expect(isOAuthReauthRequiredError({ oauthReauthRequired: true })).toBe(true);
  });

  it("returns false when explicit reauth marker is false", () => {
    expect(isOAuthReauthRequiredError({ oauthReauthRequired: false })).toBe(false);
  });

  it("returns true for invalid_grant fallback messages", () => {
    expect(
      isOAuthReauthRequiredError(new Error("Token refresh failed (400): {\"error\":\"invalid_grant\"}")),
    ).toBe(true);
  });

  it("returns false for transient timeout messages", () => {
    expect(
      isOAuthReauthRequiredError(new Error("Token refresh timed out after 15000ms")),
    ).toBe(false);
  });
});
