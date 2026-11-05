import type { MicrosoftDirectoryTenant, MicrosoftOAuthCredentials } from "@keeper.sh/data-schemas";

const MICROSOFT_AUTHORITY_URL = "https://login.microsoftonline.com";
const GRAPH_DEFAULT_SCOPE = "https://graph.microsoft.com/.default";
const TENANTS_WITHOUT_AN_ADMIN = new Set<MicrosoftDirectoryTenant>(["common", "consumers"]);

interface AdminConsentUrlInput {
  credentials: Pick<MicrosoftOAuthCredentials, "clientId" | "tenant">;
  callbackUrl: string;
}

const resolveAdminConsentTenant = (tenant: MicrosoftDirectoryTenant): MicrosoftDirectoryTenant => {
  if (TENANTS_WITHOUT_AN_ADMIN.has(tenant)) {
    return "organizations";
  }
  return tenant;
};

const buildMicrosoftAdminConsentUrl = ({ credentials, callbackUrl }: AdminConsentUrlInput): string => {
  const tenant = resolveAdminConsentTenant(credentials.tenant);
  const url = new URL(`${MICROSOFT_AUTHORITY_URL}/${tenant}/v2.0/adminconsent`);
  url.searchParams.set("client_id", credentials.clientId);
  url.searchParams.set("scope", GRAPH_DEFAULT_SCOPE);
  url.searchParams.set("redirect_uri", callbackUrl);
  return url.toString();
};

export { buildMicrosoftAdminConsentUrl };
