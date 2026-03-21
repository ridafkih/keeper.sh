import { describe, expect, it } from "bun:test";
import { resolveOAuthClientConfig } from "./oauth-client-config";

describe("resolveOAuthClientConfig", () => {
  it("resolves google oauth client config", () => {
    expect(resolveOAuthClientConfig("google", {
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
    })).toEqual({
      clientId: "google-client-id",
      clientSecret: "google-client-secret",
    });
  });

  it("resolves outlook oauth client config", () => {
    expect(resolveOAuthClientConfig("outlook", {
      microsoftClientId: "microsoft-client-id",
      microsoftClientSecret: "microsoft-client-secret",
    })).toEqual({
      clientId: "microsoft-client-id",
      clientSecret: "microsoft-client-secret",
    });
  });

  it("returns null for missing google config", () => {
    expect(resolveOAuthClientConfig("google", {
      googleClientId: "google-client-id",
    })).toBeNull();
  });

  it("returns null for missing outlook config", () => {
    expect(resolveOAuthClientConfig("outlook", {
      microsoftClientSecret: "microsoft-client-secret",
    })).toBeNull();
  });
});
