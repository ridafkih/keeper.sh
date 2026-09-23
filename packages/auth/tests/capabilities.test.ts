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
      requiresEmailVerification: false,
      socialProviders: {
        google: true,
        microsoft: true,
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
      requiresEmailVerification: true,
      socialProviders: {
        google: true,
        microsoft: true,
      },
      supportsChangePassword: true,
      supportsPasskeys: true,
      supportsPasswordReset: true,
    });
  });

  it("enables the oidc provider when issuer, client id and secret are configured", () => {
    const capabilities = resolveAuthCapabilities({
      oidcClientId: "oidc-client-id",
      oidcClientSecret: "oidc-client-secret",
      oidcIssuerUrl: "https://id.example.com",
    });

    expect(capabilities.socialProviders.oidc).toBe(true);
    expect("disableLocalAuth" in capabilities).toBe(false);
  });

  it("leaves the oidc keys out entirely when oidc is not configured", () => {
    const capabilities = resolveAuthCapabilities({
      disableLocalAuth: true,
      oidcProviderName: "Pocket ID",
    });

    expect("oidc" in capabilities.socialProviders).toBe(false);
    expect("disableLocalAuth" in capabilities).toBe(false);
    expect("oidcProviderName" in capabilities).toBe(false);
  });

  it("leaves oidc disabled when any of its credentials is missing", () => {
    const capabilities = resolveAuthCapabilities({
      oidcClientId: "oidc-client-id",
      oidcIssuerUrl: "https://id.example.com",
    });

    expect("oidc" in capabilities.socialProviders).toBe(false);
  });

  it("disables local auth only when both oidc and DISABLE_LOCAL_AUTH are set", () => {
    const capabilities = resolveAuthCapabilities({
      disableLocalAuth: true,
      oidcClientId: "oidc-client-id",
      oidcClientSecret: "oidc-client-secret",
      oidcIssuerUrl: "https://id.example.com",
    });

    expect(capabilities.socialProviders.oidc).toBe(true);
    expect(capabilities.disableLocalAuth).toBe(true);
  });

  it("exposes the configured oidc provider name when oidc is enabled", () => {
    const capabilities = resolveAuthCapabilities({
      oidcClientId: "oidc-client-id",
      oidcClientSecret: "oidc-client-secret",
      oidcIssuerUrl: "https://id.example.com",
      oidcProviderName: "Pocket ID",
    });

    expect(capabilities.oidcProviderName).toBe("Pocket ID");
  });
});
