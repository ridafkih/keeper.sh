import { describe, expect, it } from "vitest";
import { OAuthRefreshInProgressError } from "@keeper.sh/calendar";
import { isBackoffEligibleError } from "../src/destination-errors";

const CREDENTIAL_ID = "b3d4e5f6-0718-4293-be5f-60718293a4b5";

describe("a destination run interrupted by another process refreshing the same credential", () => {
  it("never parks the destination for a coordination event", () => {
    expect(isBackoffEligibleError(new OAuthRefreshInProgressError(CREDENTIAL_ID))).toBe(false);
  });

  it("stays ineligible when the coordination error is wrapped by a caller", () => {
    const wrapped = new Error("Push sync failed", {
      cause: new OAuthRefreshInProgressError(CREDENTIAL_ID),
    });

    expect(isBackoffEligibleError(wrapped)).toBe(false);
  });

  it("does not park the destination when a refresh needs the user to reconnect", () => {
    const reauthRequired = Object.assign(
      new Error("Token refresh failed (400): {\"error\":\"invalid_grant\"}"),
      { oauthReauthRequired: true },
    );

    expect(isBackoffEligibleError(reauthRequired)).toBe(false);
  });
});
