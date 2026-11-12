import { describe, expect, it } from "vitest";
import {
  buildCalendarConsentUrl,
  isConsentContinuation,
  resolveNewUserCallbackURL,
} from "@/lib/sign-up-continuation";

const origin = "https://www.keeper.sh";

describe("resolveNewUserCallbackURL", () => {
  it("sends a new Google user straight on to Google Calendar consent", () => {
    expect(resolveNewUserCallbackURL("google", "/dashboard", origin))
      .toBe("/dashboard/connect/google?continue=consent&keeper_signup=1");
  });

  it("sends a new Microsoft user straight on to Outlook consent", () => {
    expect(resolveNewUserCallbackURL("microsoft", "/dashboard", origin))
      .toBe("/dashboard/connect/outlook?continue=consent&keeper_signup=1");
  });

  it("keeps a new OIDC user on the dashboard", () => {
    expect(resolveNewUserCallbackURL("oidc", "/dashboard", origin)).toBe("/dashboard?keeper_signup=1");
  });

  it("finishes an MCP authorization before anything else", () => {
    const target = "https://api.keeper.sh/api/auth/oauth2/authorize?client_id=abc";

    expect(resolveNewUserCallbackURL("google", target, origin)).toBe(target);
  });
});

describe("buildCalendarConsentUrl", () => {
  it("asks the API to hint the signed-in account after a sign-up", () => {
    expect(buildCalendarConsentUrl("google", { forSignedInAccount: true }))
      .toBe("/api/sources/authorize?provider=google&account=sign-in");
  });

  it("leaves the account open for an ordinary connect", () => {
    expect(buildCalendarConsentUrl("outlook", { forSignedInAccount: false }))
      .toBe("/api/sources/authorize?provider=outlook");
  });

  it("brings a connect started in onboarding back to it", () => {
    expect(buildCalendarConsentUrl("google", { forSignedInAccount: false, returnTo: "onboarding" }))
      .toBe("/api/sources/authorize?provider=google&returnTo=onboarding");
  });
});

describe("isConsentContinuation", () => {
  it("recognises only the consent continuation", () => {
    expect(isConsentContinuation("consent")).toBe(true);
    expect(isConsentContinuation("welcome")).toBe(false);
    expect(isConsentContinuation(undefined)).toBe(false);
  });
});
