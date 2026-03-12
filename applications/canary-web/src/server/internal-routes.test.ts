import { describe, expect, it } from "bun:test";
import { resolveInternalProxyPath } from "./internal-routes";

describe("resolveInternalProxyPath", () => {
  it("maps OAuth authorization-server metadata to the API auth handler", () => {
    expect(resolveInternalProxyPath("/.well-known/oauth-authorization-server")).toBe(
      "/api/auth/.well-known/oauth-authorization-server",
    );
  });

  it("maps OpenID metadata to the API auth handler", () => {
    expect(resolveInternalProxyPath("/.well-known/openid-configuration")).toBe(
      "/api/auth/.well-known/openid-configuration",
    );
  });

  it("returns null for regular application routes", () => {
    expect(resolveInternalProxyPath("/dashboard")).toBeNull();
  });
});
