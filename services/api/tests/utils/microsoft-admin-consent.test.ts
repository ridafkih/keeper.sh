import { describe, expect, it } from "vitest";
import type { MicrosoftDirectoryTenant } from "@keeper.sh/data-schemas";
import { buildMicrosoftAdminConsentUrl } from "../../src/utils/microsoft-admin-consent";

const CALLBACK_URL = "https://keeper.test.invalid/api/sources/callback/outlook";
const DIRECTORY_TENANT = "11111111-2222-3333-4444-555555555555" as MicrosoftDirectoryTenant;

const buildApprovalUrl = (tenant: MicrosoftDirectoryTenant): URL =>
  new URL(buildMicrosoftAdminConsentUrl({
    callbackUrl: CALLBACK_URL,
    credentials: { clientId: "client-1", tenant },
  }));

describe("buildMicrosoftAdminConsentUrl", () => {
  it("asks any work tenant's admin to approve the app and return to the callback", () => {
    const url = buildApprovalUrl("common");

    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/organizations/v2.0/adminconsent");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-1",
      redirect_uri: CALLBACK_URL,
      scope: "https://graph.microsoft.com/.default",
    });
  });

  it("asks the configured directory's admin when the app is limited to one tenant", () => {
    const url = buildApprovalUrl(DIRECTORY_TENANT);

    expect(url.pathname).toBe(`/${DIRECTORY_TENANT}/v2.0/adminconsent`);
  });
});
