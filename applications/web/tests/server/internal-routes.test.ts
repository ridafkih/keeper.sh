import { describe, expect, it } from "vitest";
import { handleInternalRoute, resolveInternalProxyPath } from "../../src/server/internal-routes";
import type { ServerConfig } from "../../src/server/types";

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

  it("maps path-suffixed OAuth metadata to the API auth handler", () => {
    expect(resolveInternalProxyPath("/.well-known/oauth-authorization-server/api/auth")).toBe(
      "/api/auth/.well-known/oauth-authorization-server",
    );
  });

  it("maps path-suffixed OpenID metadata to the API auth handler", () => {
    expect(resolveInternalProxyPath("/.well-known/openid-configuration/api/auth")).toBe(
      "/api/auth/.well-known/openid-configuration",
    );
  });

  it("returns null for regular application routes", () => {
    expect(resolveInternalProxyPath("/dashboard")).toBeNull();
  });
});

const geoConfig: ServerConfig = {
  apiProxyOrigin: "http://api.test",
  mcpProxyOrigin: null,
  environment: "production",
  isProduction: true,
  serverPort: 4000,
  vitePort: 4001,
};

function geoRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/internal/geo", { headers });
}

describe("/internal/geo", () => {
  it("reports that GDPR applies for an EU country", async () => {
    const response = await handleInternalRoute(geoRequest({ "cf-ipcountry": "DE" }), geoConfig);

    expect(await response?.json()).toEqual({ gdprApplies: true });
  });

  it("reports that GDPR does not apply outside the EU", async () => {
    const response = await handleInternalRoute(geoRequest({ "cf-ipcountry": "US" }), geoConfig);

    expect(await response?.json()).toEqual({ gdprApplies: false });
  });

  it("is never stored by a shared cache", async () => {
    const response = await handleInternalRoute(geoRequest({ "cf-ipcountry": "US" }), geoConfig);

    expect(response?.headers.get("cache-control")).toBe("private, no-store");
  });
});
