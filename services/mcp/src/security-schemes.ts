import { KEEPER_API_READ_SCOPE, KEEPER_API_WRITE_SCOPE } from "@keeper.sh/constants";
import type { KeeperMcpToolDefinition } from "./toolset";

interface OAuth2SecurityScheme {
  type: "oauth2";
  scopes: string[];
}

const resolveToolScopes = (tool: KeeperMcpToolDefinition<unknown>): string[] => {
  if (tool.annotations.readOnlyHint) {
    return [KEEPER_API_READ_SCOPE];
  }

  return [KEEPER_API_READ_SCOPE, KEEPER_API_WRITE_SCOPE];
};

const resolveToolSecuritySchemes = (
  tool: KeeperMcpToolDefinition<unknown>,
): OAuth2SecurityScheme[] => [{ type: "oauth2", scopes: resolveToolScopes(tool) }];

export { resolveToolScopes, resolveToolSecuritySchemes };
export type { OAuth2SecurityScheme };
