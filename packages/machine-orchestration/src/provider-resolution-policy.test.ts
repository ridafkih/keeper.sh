import { describe, expect, it } from "bun:test";
import {
  ProviderResolutionStatus,
  hasOAuthProviderConfig,
  isCaldavProviderName,
  isOAuthProviderName,
  resolveProviderSupportStatus,
  toUnresolvedProviderStatusCode,
  unresolvedProviderResolutionStatuses,
} from "./provider-resolution-policy";

describe("provider resolution policy", () => {
  it("identifies oauth providers", () => {
    expect(isOAuthProviderName("google")).toBe(true);
    expect(isOAuthProviderName("outlook")).toBe(true);
    expect(isOAuthProviderName("ical")).toBe(false);
  });

  it("identifies caldav providers", () => {
    expect(isCaldavProviderName("caldav")).toBe(true);
    expect(isCaldavProviderName("fastmail")).toBe(true);
    expect(isCaldavProviderName("icloud")).toBe(true);
    expect(isCaldavProviderName("google")).toBe(false);
  });

  it("validates oauth config by provider", () => {
    expect(hasOAuthProviderConfig("google", {
      googleClientId: "id",
      googleClientSecret: "secret",
    })).toBe(true);
    expect(hasOAuthProviderConfig("google", {
      googleClientId: "id",
    })).toBe(false);

    expect(hasOAuthProviderConfig("outlook", {
      microsoftClientId: "id",
      microsoftClientSecret: "secret",
    })).toBe(true);
    expect(hasOAuthProviderConfig("outlook", {
      microsoftClientId: "id",
    })).toBe(false);
  });

  it("resolves unsupported/misconfigured status deterministically", () => {
    expect(resolveProviderSupportStatus("google")).toBe(
      ProviderResolutionStatus.MISCONFIGURED_PROVIDER,
    );
    expect(resolveProviderSupportStatus("caldav")).toBe(
      ProviderResolutionStatus.MISCONFIGURED_PROVIDER,
    );
    expect(resolveProviderSupportStatus("caldav", "enc-key")).toBe(
      ProviderResolutionStatus.MISSING_PROVIDER_CREDENTIALS,
    );
    expect(resolveProviderSupportStatus("unknown-provider", "enc-key")).toBe(
      ProviderResolutionStatus.UNSUPPORTED_PROVIDER,
    );
  });

  it("maps unresolved statuses to deterministic machine error codes", () => {
    for (const status of unresolvedProviderResolutionStatuses) {
      expect(toUnresolvedProviderStatusCode(status)).toBe(status.toLowerCase());
    }
  });
});
