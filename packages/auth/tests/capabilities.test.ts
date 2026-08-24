import { describe, expect, it } from "vitest";
import { resolveAuthCapabilities } from "../src/capabilities";

describe("resolveAuthCapabilities", () => {
  it("uses username auth in non-commercial mode while preserving configured socials", () => {
    const capabilities = resolveAuthCapabilities({
      commercialMode: false,
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
      microsoftClientId: "microsoft-client-id",
      microsoftClientSecret: "microsoft-client-secret",
      passkeyOrigin: "https://keeper.sh",
      passkeyRpId: "keeper.sh",
    });

    expect(capabilities).toEqual({
      commercialMode: false,
      credentialMode: "username",
      disableLocalAuth: false,
      requiresEmailVerification: false,
      socialProviders: {
        google: true,
        microsoft: true,
        oidc: false,
      },
      supportsChangePassword: true,
      supportsPasskeys: false,
      supportsPasswordReset: false,
    });
  });

  it("enables email auth, passkeys, and configured socials in commercial mode", () => {
    const capabilities = resolveAuthCapabilities({
      commercialMode: true,
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
      microsoftClientId: "microsoft-client-id",
      microsoftClientSecret: "microsoft-client-secret",
      passkeyOrigin: "https://keeper.sh",
      passkeyRpId: "keeper.sh",
    });

    expect(capabilities).toEqual({
      commercialMode: true,
      credentialMode: "email",
      disableLocalAuth: false,
      requiresEmailVerification: true,
      socialProviders: {
        google: true,
        microsoft: true,
        oidc: false,
      },
      supportsChangePassword: true,
      supportsPasskeys: true,
      supportsPasswordReset: true,
    });
  });

  it("enables the oidc provider when issuer, client id and secret are configured", () => {
    const capabilities = resolveAuthCapabilities({
      oidcIssuerUrl: "https://id.example.com",
      oidcClientId: "oidc-client-id",
      oidcClientSecret: "oidc-client-secret",
    });

    expect(capabilities.socialProviders.oidc).toBe(true);
    expect(capabilities.disableLocalAuth).toBe(false);
  });

  it("does not enable local-auth disabling without an oidc provider", () => {
    const capabilities = resolveAuthCapabilities({
      disableLocalAuth: true,
    });

    expect(capabilities.socialProviders.oidc).toBe(false);
    expect(capabilities.disableLocalAuth).toBe(false);
  });

  it("disables local auth only when both oidc and DISABLE_LOCAL_AUTH are set", () => {
    const capabilities = resolveAuthCapabilities({
      oidcIssuerUrl: "https://id.example.com",
      oidcClientId: "oidc-client-id",
      oidcClientSecret: "oidc-client-secret",
      disableLocalAuth: true,
    });

    expect(capabilities.socialProviders.oidc).toBe(true);
    expect(capabilities.disableLocalAuth).toBe(true);
  });

  it("exposes the configured oidc provider name when oidc is enabled", () => {
    const capabilities = resolveAuthCapabilities({
      oidcIssuerUrl: "https://id.example.com",
      oidcClientId: "oidc-client-id",
      oidcClientSecret: "oidc-client-secret",
      oidcProviderName: "Pocket ID",
    });

    expect(capabilities.oidcProviderName).toBe("Pocket ID");
  });

  it("omits the oidc provider name when oidc is not enabled", () => {
    const capabilities = resolveAuthCapabilities({});

    expect("oidcProviderName" in capabilities).toBe(false);
  });
});
