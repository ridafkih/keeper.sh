import { describe, expect, it } from "bun:test";
import {
  OAuthProviderConfigError,
  resolveOAuthProviderConfig,
} from "./oauth-provider-config";

describe("resolveOAuthProviderConfig", () => {
  it("throws typed error when google oauth is missing", () => {
    expect(() =>
      resolveOAuthProviderConfig("google", globalThis.undefined, "secret"),
    ).toThrow(OAuthProviderConfigError);
  });

  it("throws typed error when microsoft oauth is missing", () => {
    expect(() =>
      resolveOAuthProviderConfig("microsoft", "id", globalThis.undefined),
    ).toThrow(OAuthProviderConfigError);
  });

  it("returns typed provider config when fully configured", () => {
    expect(resolveOAuthProviderConfig("google", "id", "secret")).toEqual({
      clientId: "id",
      clientSecret: "secret",
    });
    expect(resolveOAuthProviderConfig("microsoft", "id", "secret")).toEqual({
      clientId: "id",
      clientSecret: "secret",
    });
  });
});
