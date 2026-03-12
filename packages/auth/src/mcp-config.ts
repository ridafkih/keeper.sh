const KEEPER_MCP_READ_SCOPE = "keeper.read";
const KEEPER_MCP_SOURCE_SCOPE = "keeper.sources.read";
const KEEPER_MCP_DESTINATION_SCOPE = "keeper.destinations.read";
const KEEPER_MCP_MAPPING_SCOPE = "keeper.mappings.read";
const KEEPER_MCP_EVENT_SCOPE = "keeper.events.read";
const KEEPER_MCP_SYNC_SCOPE = "keeper.sync-status.read";

const KEEPER_MCP_SCOPES = [
  KEEPER_MCP_READ_SCOPE,
  KEEPER_MCP_SOURCE_SCOPE,
  KEEPER_MCP_DESTINATION_SCOPE,
  KEEPER_MCP_MAPPING_SCOPE,
  KEEPER_MCP_EVENT_SCOPE,
  KEEPER_MCP_SYNC_SCOPE,
];

const KEEPER_MCP_RESOURCE_SCOPES = [...KEEPER_MCP_SCOPES];

const KEEPER_MCP_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  ...KEEPER_MCP_RESOURCE_SCOPES,
];

const KEEPER_MCP_DEFAULT_SCOPE = ["offline_access", ...KEEPER_MCP_RESOURCE_SCOPES].join(" ");

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

const resolveResourceUrl = (baseUrl: string): string => {
  const url = new URL(baseUrl);
  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = "/mcp";
  }
  return url.toString().replace(/\/$/, "");
};

const resolveValidAudiences = (resourceBaseUrl: string): string[] => {
  const origin = new URL(resourceBaseUrl).origin;
  const resourceUrl = resolveResourceUrl(resourceBaseUrl);
  const audiences = new Set([origin, resourceUrl, resourceBaseUrl.replace(/\/$/, "")]);
  return [...audiences];
};

const resolveMcpAuthOptions = (
  input: ResolveMcpAuthOptionsInput,
): ResolvedMcpAuthOptions | null => {
  if (!input.webBaseUrl || !input.resourceBaseUrl) {
    return null;
  }

  const resourceUrl = resolveResourceUrl(input.resourceBaseUrl);

  return {
    oauthProvider: {
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationAllowedScopes: ["offline_access", ...KEEPER_MCP_RESOURCE_SCOPES],
      clientRegistrationDefaultScopes: ["offline_access", ...KEEPER_MCP_RESOURCE_SCOPES],
      consentPage: resolveAbsoluteUrl("/mcp/consent", input.webBaseUrl),
      loginPage: resolveAbsoluteUrl("/login", input.webBaseUrl),
      scopes: KEEPER_MCP_OAUTH_SCOPES,
      validAudiences: resolveValidAudiences(input.resourceBaseUrl),
    },
    protectedResourceMetadata: {
      resource: resourceUrl,
      scopes_supported: KEEPER_MCP_RESOURCE_SCOPES,
    },
  };
};

export {
  KEEPER_MCP_DEFAULT_SCOPE,
  KEEPER_MCP_DESTINATION_SCOPE,
  KEEPER_MCP_EVENT_SCOPE,
  KEEPER_MCP_MAPPING_SCOPE,
  KEEPER_MCP_OAUTH_SCOPES,
  KEEPER_MCP_READ_SCOPE,
  KEEPER_MCP_RESOURCE_SCOPES,
  KEEPER_MCP_SCOPES,
  KEEPER_MCP_SOURCE_SCOPE,
  KEEPER_MCP_SYNC_SCOPE,
  resolveMcpAuthOptions,
};
export type { ResolvedMcpAuthOptions, ResolveMcpAuthOptionsInput };
