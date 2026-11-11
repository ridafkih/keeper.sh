import { describe, expect, it } from "vitest";
import { resolveProviderFailureReason } from "../../src/utils/oauth-callback-failure";

describe("resolveProviderFailureReason", () => {
  it("treats a cancelled consent screen as declined access", () => {
    expect(resolveProviderFailureReason({ error: "access_denied" })).toBe("access-declined");
  });

  it("treats a Microsoft tenant that blocks user consent as needing admin approval", () => {
    expect(resolveProviderFailureReason({
      error: "access_denied",
      errorDescription: "AADSTS90094: The grant requires admin permission.",
    })).toBe("admin-approval-required");
  });

  it("treats a Microsoft consent requirement as needing admin approval", () => {
    expect(resolveProviderFailureReason({
      error: "invalid_client",
      errorDescription: "AADSTS65001: The user or administrator has not consented to use the application.",
    })).toBe("admin-approval-required");
  });

  it("treats a Microsoft user who declined consent as declined access", () => {
    expect(resolveProviderFailureReason({
      error: "access_denied",
      errorDescription: "AADSTS65004: User declined to consent to access the app.",
    })).toBe("access-declined");
  });

  it("leaves any other provider error unclassified", () => {
    expect(resolveProviderFailureReason({ error: "server_error" })).toBe("unknown");
  });
});
