import { describe, expect, it } from "bun:test";
import {
  KEEPER_API_DEFAULT_SCOPE,
  KEEPER_API_READ_SCOPE,
  KEEPER_API_RESOURCE_SCOPES,
  KEEPER_API_SCOPES,
  KEEPER_MCP_OAUTH_SCOPES,
  resolveMcpAuthOptions,
} from "./mcp-config";

describe("resolveMcpAuthOptions", () => {
  it("builds Keeper OAuth provider settings from the Keeper web and MCP URLs", () => {
    expect(
      resolveMcpAuthOptions({
        resourceBaseUrl: "https://mcp.keeper.sh",
        webBaseUrl: "https://app.keeper.sh",
      }),
    ).toEqual({
      oauthProvider: {
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationAllowedScopes: KEEPER_MCP_OAUTH_SCOPES,
        clientRegistrationDefaultScopes: ["offline_access", ...KEEPER_API_RESOURCE_SCOPES],
        consentPage: "https://app.keeper.sh/oauth/consent",
        loginPage: "https://app.keeper.sh/login",
        scopes: KEEPER_MCP_OAUTH_SCOPES,
        silenceWarnings: {
          oauthAuthServerConfig: true,
        },
        validAudiences: ["https://mcp.keeper.sh"],
      },
      protectedResourceMetadata: {
        resource: "https://mcp.keeper.sh",
        scopes_supported: KEEPER_API_RESOURCE_SCOPES,
      },
    });
  });

  it("returns null when Keeper does not know both the web and MCP URLs", () => {
    expect(
      resolveMcpAuthOptions({
        resourceBaseUrl: "https://mcp.keeper.sh",
      }),
    ).toBeNull();

    expect(
      resolveMcpAuthOptions({
        webBaseUrl: "https://app.keeper.sh",
      }),
    ).toBeNull();
  });

  it("keeps keeper.read inside the supported scope list and default scope", () => {
    expect(KEEPER_API_SCOPES).toContain(KEEPER_API_READ_SCOPE);
    expect(KEEPER_API_DEFAULT_SCOPE.split(" ")).toContain(KEEPER_API_READ_SCOPE);
    expect(KEEPER_API_RESOURCE_SCOPES).toContain(KEEPER_API_READ_SCOPE);
  });

  it("supports offline_access for refresh tokens without advertising it as a resource scope", () => {
    expect(KEEPER_MCP_OAUTH_SCOPES).toContain("offline_access");
    expect(KEEPER_API_RESOURCE_SCOPES).not.toContain("offline_access");
    expect(KEEPER_API_DEFAULT_SCOPE.split(" ")).toContain("offline_access");
  });
});
