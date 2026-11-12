import { KEEPER_API_READ_SCOPE, KEEPER_API_WRITE_SCOPE } from "@keeper.sh/constants";

const MCP_TOKEN_VERSION_CLAIM = "keeper_token_version";
const LEGACY_MCP_TOKEN_VERSION = 1;
const CURRENT_MCP_TOKEN_VERSION = 2;

const READ_METHODS = new Set(["GET", "HEAD"]);

type McpTokenVersion = typeof LEGACY_MCP_TOKEN_VERSION | typeof CURRENT_MCP_TOKEN_VERSION;

interface McpTokenAccess {
  method: string;
  scopes: string;
  tokenVersion: McpTokenVersion;
}

const readMcpTokenVersion = (value: unknown): McpTokenVersion => {
  if (value === CURRENT_MCP_TOKEN_VERSION) {
    return CURRENT_MCP_TOKEN_VERSION;
  }
  return LEGACY_MCP_TOKEN_VERSION;
};

const resolveClientTokenVersion = (metadata?: Record<string, unknown>): McpTokenVersion => {
  if (metadata?.[MCP_TOKEN_VERSION_CLAIM] === LEGACY_MCP_TOKEN_VERSION) {
    return LEGACY_MCP_TOKEN_VERSION;
  }
  return CURRENT_MCP_TOKEN_VERSION;
};

const resolveMcpAccessTokenClaims = ({
  metadata,
}: {
  metadata?: Record<string, unknown>;
}): Record<typeof MCP_TOKEN_VERSION_CLAIM, McpTokenVersion> => ({
  [MCP_TOKEN_VERSION_CLAIM]: resolveClientTokenVersion(metadata),
});

const hasScope = (scopes: string, requiredScope: string): boolean =>
  scopes
    .split(/\s+/)
    .filter((scope) => scope.length > 0)
    .includes(requiredScope);

const resolveRequiredMcpScope = (method: string): string => {
  if (READ_METHODS.has(method.toUpperCase())) {
    return KEEPER_API_READ_SCOPE;
  }
  return KEEPER_API_WRITE_SCOPE;
};

const resolveMissingMcpScope = ({ method, scopes, tokenVersion }: McpTokenAccess): string | null => {
  if (tokenVersion === LEGACY_MCP_TOKEN_VERSION) {
    return null;
  }

  const requiredScope = resolveRequiredMcpScope(method);

  if (hasScope(scopes, requiredScope)) {
    return null;
  }
  return requiredScope;
};

export {
  CURRENT_MCP_TOKEN_VERSION,
  LEGACY_MCP_TOKEN_VERSION,
  MCP_TOKEN_VERSION_CLAIM,
  readMcpTokenVersion,
  resolveMcpAccessTokenClaims,
  resolveMissingMcpScope,
};
export type { McpTokenAccess, McpTokenVersion };
