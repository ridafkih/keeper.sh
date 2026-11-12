import { describe, expect, it } from "vitest";
import {
  CURRENT_MCP_TOKEN_VERSION,
  LEGACY_MCP_TOKEN_VERSION,
  readMcpTokenVersion,
  resolveMcpAccessTokenClaims,
  resolveMissingMcpScope,
} from "../src/mcp-token-version";

describe("readMcpTokenVersion", () => {
  it("reads version 2 when the token carries it", () => {
    expect(readMcpTokenVersion(2)).toBe(CURRENT_MCP_TOKEN_VERSION);
  });

  it("treats a token without the claim as legacy", () => {
    expect(readMcpTokenVersion(null)).toBe(LEGACY_MCP_TOKEN_VERSION);
  });

  it("treats any other value as legacy", () => {
    expect(readMcpTokenVersion("2")).toBe(LEGACY_MCP_TOKEN_VERSION);
    expect(readMcpTokenVersion(3)).toBe(LEGACY_MCP_TOKEN_VERSION);
  });
});

describe("resolveMcpAccessTokenClaims", () => {
  it("carries the version stamped on the client into the token", () => {
    expect(resolveMcpAccessTokenClaims({ metadata: { keeper_token_version: 2 } })).toEqual({
      keeper_token_version: 2,
    });
  });

  it("keeps tokens for clients marked legacy on version 1", () => {
    expect(resolveMcpAccessTokenClaims({ metadata: { keeper_token_version: 1 } })).toEqual({
      keeper_token_version: 1,
    });
  });

  it("issues version 2 to clients without a version", () => {
    expect(resolveMcpAccessTokenClaims({})).toEqual({ keeper_token_version: 2 });
    expect(resolveMcpAccessTokenClaims({ metadata: { software: "client" } })).toEqual({
      keeper_token_version: 2,
    });
    expect(resolveMcpAccessTokenClaims({ metadata: { keeper_token_version: "1" } })).toEqual({
      keeper_token_version: 2,
    });
  });
});

describe("resolveMissingMcpScope", () => {
  it("lets legacy tokens through regardless of scope", () => {
    expect(
      resolveMissingMcpScope({ method: "DELETE", scopes: "keeper.read", tokenVersion: 1 }),
    ).toBeNull();
  });

  it("requires keeper.read for reads on version 2 tokens", () => {
    expect(resolveMissingMcpScope({ method: "GET", scopes: "keeper.read", tokenVersion: 2 })).toBeNull();
    expect(resolveMissingMcpScope({ method: "GET", scopes: "keeper.write", tokenVersion: 2 })).toBe(
      "keeper.read",
    );
  });

  it("requires keeper.write for writes on version 2 tokens", () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(resolveMissingMcpScope({ method, scopes: "keeper.read", tokenVersion: 2 })).toBe(
        "keeper.write",
      );
      expect(
        resolveMissingMcpScope({ method, scopes: "keeper.read keeper.write", tokenVersion: 2 }),
      ).toBeNull();
    }
  });

  it("matches whole scopes, not substrings", () => {
    expect(
      resolveMissingMcpScope({ method: "POST", scopes: "keeper.writer", tokenVersion: 2 }),
    ).toBe("keeper.write");
  });
});
