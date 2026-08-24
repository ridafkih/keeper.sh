import { describe, expect, it } from "vitest";
import {
  getEnabledSocialProviders,
  resolveCredentialField,
  resolveOidcProviderName,
  supportsPasskeys,
  type AuthCapabilities,
} from "../../src/lib/auth-capabilities";

const emailCapabilities: AuthCapabilities = {
  commercialMode: true,
  credentialMode: "email",
  disableLocalAuth: false,
  requiresEmailVerification: true,
  socialProviders: {
    google: true,
    microsoft: false,
    oidc: false,
  },
  supportsChangePassword: true,
  supportsPasskeys: true,
  supportsPasswordReset: true,
};

describe("resolveCredentialField", () => {
  it("returns email field metadata for commercial auth", () => {
    expect(resolveCredentialField(emailCapabilities)).toEqual({
      autoComplete: "email",
      id: "email",
      label: "Email",
      name: "email",
      placeholder: "johndoe+keeper@example.com",
      type: "email",
    });
  });

  it("returns username field metadata for non-commercial auth", () => {
    expect(resolveCredentialField({
      ...emailCapabilities,
      credentialMode: "username",
    })).toEqual({
      autoComplete: "username",
      id: "username",
      label: "Username",
      name: "username",
      placeholder: "johndoe",
      type: "text",
    });
  });
});

describe("getEnabledSocialProviders", () => {
  it("returns only enabled social providers", () => {
    expect(getEnabledSocialProviders(emailCapabilities)).toEqual(["google"]);
  });

  it("includes oidc when it is enabled", () => {
    expect(getEnabledSocialProviders({
      ...emailCapabilities,
      socialProviders: { google: false, microsoft: false, oidc: true },
    })).toEqual(["oidc"]);
  });
});

describe("resolveOidcProviderName", () => {
  it("returns the configured provider name when present", () => {
    expect(resolveOidcProviderName({
      ...emailCapabilities,
      oidcProviderName: "Pocket ID",
    })).toBe("Pocket ID");
  });

  it("falls back to SSO when no name is configured", () => {
    expect(resolveOidcProviderName(emailCapabilities)).toBe("SSO");
  });
});

describe("supportsPasskeys", () => {
  it("returns false when passkeys are disabled", () => {
    expect(supportsPasskeys({
      ...emailCapabilities,
      supportsPasskeys: false,
    })).toBe(false);
  });
});
