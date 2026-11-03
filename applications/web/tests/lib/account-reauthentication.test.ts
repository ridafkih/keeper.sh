import { describe, expect, it } from "vitest";
import type { AuthCapabilities } from "@keeper.sh/data-schemas";
import {
  ACCOUNT_DELETION_REAUTHENTICATION_PATH,
  readsAsReauthenticationReturn,
  resolveAccountDeletionOutcome,
  resolveReauthenticationMethods,
} from "../../src/lib/account-reauthentication";

const capabilities: AuthCapabilities = {
  commercialMode: true,
  credentialMode: "email",
  requiresEmailVerification: true,
  socialProviders: { google: true, microsoft: true },
  supportsChangePassword: true,
  supportsPasskeys: true,
  supportsPasswordReset: true,
};

describe("resolveAccountDeletionOutcome", () => {
  it("treats a stale session as a request to sign in again rather than a failure", () => {
    expect(
      resolveAccountDeletionOutcome({
        code: "SESSION_EXPIRED",
        message: "Session expired. Re-authenticate to perform this action.",
      }),
    ).toBe("reauthentication-required");
  });

  it("reports a deletion that went through", () => {
    expect(resolveAccountDeletionOutcome(null)).toBe("deleted");
  });

  it("surfaces any other failure with the server's message", () => {
    expect(() =>
      resolveAccountDeletionOutcome({ code: "INVALID_PASSWORD", message: "Invalid password" }),
    ).toThrow("Invalid password");
  });
});

describe("resolveReauthenticationMethods", () => {
  it("offers the social provider the account signed up with", () => {
    expect(
      resolveReauthenticationMethods({
        capabilities,
        linkedProviderIds: ["google"],
        passkeyCount: 0,
      }),
    ).toEqual([{ kind: "social", provider: "google" }]);
  });

  it("offers a passkey when the account has one", () => {
    expect(
      resolveReauthenticationMethods({
        capabilities,
        linkedProviderIds: ["microsoft"],
        passkeyCount: 1,
      }),
    ).toEqual([
      { kind: "passkey" },
      { kind: "social", provider: "microsoft" },
    ]);
  });

  it("leaves out providers this deployment has turned off", () => {
    expect(
      resolveReauthenticationMethods({
        capabilities: { ...capabilities, socialProviders: { google: true, microsoft: false } },
        linkedProviderIds: ["google", "microsoft", "credential"],
        passkeyCount: 0,
      }),
    ).toEqual([{ kind: "social", provider: "google" }]);
  });

  it("leaves out passkeys when this deployment does not support them", () => {
    expect(
      resolveReauthenticationMethods({
        capabilities: { ...capabilities, supportsPasskeys: false },
        linkedProviderIds: [],
        passkeyCount: 2,
      }),
    ).toEqual([]);
  });
});

describe("readsAsReauthenticationReturn", () => {
  it("recognises the return from a provider sign-in made to confirm deletion", () => {
    const [, query = ""] = ACCOUNT_DELETION_REAUTHENTICATION_PATH.split("?");
    expect(readsAsReauthenticationReturn(Object.fromEntries(new URLSearchParams(query)))).toBe(true);
  });

  it("ignores an ordinary visit to settings", () => {
    expect(readsAsReauthenticationReturn({})).toBe(false);
  });
});
