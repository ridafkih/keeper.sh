import { describe, expect, it } from "vitest";
import { buildMicrosoftAdminConsentUrl } from "../../src/utils/microsoft-admin-consent";

describe("buildMicrosoftAdminConsentUrl", () => {
  it("asks any work tenant's admin to approve the app and return to the callback", () => {
    const url = new URL(buildMicrosoftAdminConsentUrl({
      callbackUrl: "https://keeper.test.invalid/api/sources/callback/outlook",
      clientId: "client-1",
    }));

    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/organizations/v2.0/adminconsent");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-1",
      redirect_uri: "https://keeper.test.invalid/api/sources/callback/outlook",
      scope: "https://graph.microsoft.com/.default",
    });
  });
});
