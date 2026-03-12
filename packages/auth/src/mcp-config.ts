import {
  KEEPER_API_DEFAULT_SCOPE,
  KEEPER_API_DESTINATION_SCOPE,
  KEEPER_API_EVENT_SCOPE,
  KEEPER_API_MAPPING_SCOPE,
  KEEPER_API_READ_SCOPE,
  KEEPER_API_RESOURCE_SCOPES,
  KEEPER_API_SCOPES,
  KEEPER_API_SOURCE_SCOPE,
  KEEPER_API_SYNC_SCOPE,
} from "@keeper.sh/keeper-api/scopes";

const KEEPER_MCP_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  ...KEEPER_API_RESOURCE_SCOPES,
];

interface ResolveMcpAuthOptionsInput {
  resourceBaseUrl?: string;
  webBaseUrl?: string;
}

interface ResolvedMcpAuthOptions {
  oauthProvider: {
    allowDynamicClientRegistration: true;
    allowUnauthenticatedClientRegistration: true;
    clientRegistrationAllowedScopes: string[];
    clientRegistrationDefaultScopes: string[];
    consentPage: string;
    loginPage: string;
    scopes: string[];
    validAudiences: string[];
  };
  protectedResourceMetadata: {
    resource: string;
    scopes_supported: string[];
  };
}

const resolveAbsoluteUrl = (pathname: string, baseUrl: string): string =>
  new URL(pathname, baseUrl).toString();

const normalizeUrl = (url: string): string =>
  url.replace(/\/$/, "");

const resolveValidAudiences = (resourceBaseUrl: string): string[] => {
  const normalized = normalizeUrl(resourceBaseUrl);
  const { origin } = new URL(resourceBaseUrl);
  const audiences = new Set([origin, normalized]);
  return [...audiences];
};

const resolveMcpAuthOptions = (
  input: ResolveMcpAuthOptionsInput,
): ResolvedMcpAuthOptions | null => {
  if (!input.webBaseUrl || !input.resourceBaseUrl) {
    return null;
  }

  const resourceUrl = normalizeUrl(input.resourceBaseUrl);

  return {
    oauthProvider: {
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationAllowedScopes: ["offline_access", ...KEEPER_API_RESOURCE_SCOPES],
      clientRegistrationDefaultScopes: ["offline_access", ...KEEPER_API_RESOURCE_SCOPES],
      consentPage: resolveAbsoluteUrl("/mcp/consent", input.webBaseUrl),
      loginPage: resolveAbsoluteUrl("/login", input.webBaseUrl),
      scopes: KEEPER_MCP_OAUTH_SCOPES,
      validAudiences: resolveValidAudiences(input.resourceBaseUrl),
    },
    protectedResourceMetadata: {
      resource: resourceUrl,
      scopes_supported: KEEPER_API_RESOURCE_SCOPES,
    },
  };
};

export {
  KEEPER_API_DEFAULT_SCOPE,
  KEEPER_API_DESTINATION_SCOPE,
  KEEPER_API_EVENT_SCOPE,
  KEEPER_API_MAPPING_SCOPE,
  KEEPER_API_READ_SCOPE,
  KEEPER_API_RESOURCE_SCOPES,
  KEEPER_API_SCOPES,
  KEEPER_API_SOURCE_SCOPE,
  KEEPER_API_SYNC_SCOPE,
  KEEPER_MCP_OAUTH_SCOPES,
  resolveMcpAuthOptions,
};
export type { ResolvedMcpAuthOptions, ResolveMcpAuthOptionsInput };
