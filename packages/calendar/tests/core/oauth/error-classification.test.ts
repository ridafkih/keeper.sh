import { describe, expect, it } from "vitest";
import { isOAuthReauthRequiredError, isOAuthOperatorFaultError } from "../../../src/core/oauth/error-classification";

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

describe("operator-fault errors", () => {
  it("does not demand reauthentication for an invalid client secret", () => {
    // AADSTS7000215 is our client registration, not the user's grant; a reconnect cannot fix it.
    const error = new Error(
      "invalid_client: AADSTS7000215: Invalid client secret provided.",
    );

    expect(isOAuthReauthRequiredError(error)).toBe(false);
  });

  it("does not demand reauthentication for an expired client secret", () => {
    const error = new Error("AADSTS7000222: The provided client secret keys are expired.");

    expect(isOAuthReauthRequiredError(error)).toBe(false);
  });

  it("still demands reauthentication for a revoked grant", () => {
    const error = new Error(
      "invalid_grant: AADSTS50173: The provided grant has expired due to it being revoked.",
    );

    expect(isOAuthReauthRequiredError(error)).toBe(true);
  });

  it("ignores an operator fault even when it arrives beside invalid_grant", () => {
    const error = new Error("invalid_grant unauthorized_client");

    expect(isOAuthReauthRequiredError(error)).toBe(false);
  });
});

describe("isOAuthOperatorFaultError", () => {
  it("identifies a client misconfiguration so it can be reported separately", () => {
    const error = new Error("invalid_client: AADSTS7000215: Invalid client secret provided.");

    expect(isOAuthOperatorFaultError(error)).toBe(true);
  });

  it("does not claim a revoked grant", () => {
    const error = new Error("invalid_grant: AADSTS50173");

    expect(isOAuthOperatorFaultError(error)).toBe(false);
  });

  it("ignores a non-Error rejection", () => {
    expect(isOAuthOperatorFaultError("invalid_client")).toBe(false);
  });
});
