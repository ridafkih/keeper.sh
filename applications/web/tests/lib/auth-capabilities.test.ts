import { describe, expect, it } from "bun:test";
import {
  getEnabledSocialProviders,
  resolveCredentialField,
  supportsPasskeys,
  type AuthCapabilities,
} from "../../src/lib/auth-capabilities";

const emailCapabilities: AuthCapabilities = {
  commercialMode: true,
  credentialMode: "email",
  requiresEmailVerification: true,
  socialProviders: {
    google: true,
    microsoft: false,
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
});

describe("supportsPasskeys", () => {
  it("returns false when passkeys are disabled", () => {
    expect(supportsPasskeys({
      ...emailCapabilities,
      supportsPasskeys: false,
    })).toBe(false);
  });
});
