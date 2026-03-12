import { describe, expect, it } from "bun:test";
import {
  getMcpAuthorizationSearch,
  resolvePostAuthRedirect,
} from "./mcp-auth-flow";

describe("getMcpAuthorizationSearch", () => {
  it("recognizes MCP authorization search params copied from Better Auth", () => {
    const result = getMcpAuthorizationSearch({
      client_id: "keeper-client",
      code_challenge: "challenge",
      code_challenge_method: "S256",
      redirect_uri: "https://claude.ai/callback",
      response_type: "code",
      scope: "openid profile email offline_access keeper.read",
      state: "opaque-state",
    });

    expect(result).not.toBeNull();
  });

  it("returns null for regular login query params", () => {
    expect(
      getMcpAuthorizationSearch({
        next: "/dashboard",
      }),
    ).toBeNull();
  });
});

describe("resolvePostAuthRedirect", () => {
  it("resumes the Better Auth MCP authorization flow after login", () => {
    expect(
      resolvePostAuthRedirect({
        apiOrigin: "https://api.keeper.sh",
        defaultPath: "/dashboard",
        search: {
          client_id: "keeper-client",
          code_challenge: "challenge",
          code_challenge_method: "S256",
          redirect_uri: "https://claude.ai/callback",
          response_type: "code",
          scope: "openid profile email offline_access keeper.read",
          state: "opaque-state",
          prompt: "consent",
          resource: "https://mcp.keeper.sh",
        },
      }),
    ).toBe(
      "https://api.keeper.sh/api/auth/oauth2/authorize?client_id=keeper-client&code_challenge=challenge&code_challenge_method=S256&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcallback&response_type=code&scope=openid+profile+email+offline_access+keeper.read&state=opaque-state&prompt=consent&resource=https%3A%2F%2Fmcp.keeper.sh",
    );
  });

  it("falls back to the default in-app redirect when there is no MCP continuation", () => {
    expect(
      resolvePostAuthRedirect({
        apiOrigin: "https://api.keeper.sh",
        defaultPath: "/dashboard",
        search: {
          next: "/dashboard",
        },
      }),
    ).toBe("/dashboard");
  });
});

describe("getMcpAuthorizationSearch", () => {
  it("preserves optional OAuth continuation params after validating the required MCP ones", () => {
    expect(
      getMcpAuthorizationSearch({
        client_id: "keeper-client",
        code_challenge: "challenge",
        code_challenge_method: "S256",
        prompt: "consent",
        redirect_uri: "https://claude.ai/callback",
        resource: "https://mcp.keeper.sh",
        response_type: "code",
        scope: "offline_access keeper.read",
        state: "opaque-state",
      }),
    ).toEqual({
      client_id: "keeper-client",
      code_challenge: "challenge",
      code_challenge_method: "S256",
      prompt: "consent",
      redirect_uri: "https://claude.ai/callback",
      resource: "https://mcp.keeper.sh",
      response_type: "code",
      scope: "offline_access keeper.read",
      state: "opaque-state",
    });
  });
});
