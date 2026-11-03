const ADMIN_CONSENT_ENDPOINT = "https://login.microsoftonline.com/organizations/v2.0/adminconsent";
const GRAPH_DEFAULT_SCOPE = "https://graph.microsoft.com/.default";

interface AdminConsentUrlInput {
  clientId: string;
  callbackUrl: string;
}

const buildMicrosoftAdminConsentUrl = ({ clientId, callbackUrl }: AdminConsentUrlInput): string => {
  const url = new URL(ADMIN_CONSENT_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", GRAPH_DEFAULT_SCOPE);
  url.searchParams.set("redirect_uri", callbackUrl);
  return url.toString();
};

export { buildMicrosoftAdminConsentUrl };
