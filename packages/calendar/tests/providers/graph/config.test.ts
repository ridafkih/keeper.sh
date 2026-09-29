import { afterEach, describe, expect, it, vi } from "vitest";
import { parseGraphConfig, graphDeviceConfig } from "../../../src/providers/graph";
import { createCoordinatedRefresher } from "../../../src/core/oauth/coordinated-refresher";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
const clientId = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.unstubAllGlobals());
describe("Graph client configuration", () => {
  it("uses the supplied Client ID and tenant for both device and token endpoints", () => {
    const config = graphDeviceConfig(parseGraphConfig({ clientId, tenant: "example.onmicrosoft.com" }));
    expect(config.auth.clientId).toBe(clientId);
    expect(config.auth.deviceAuthorizationUrl).toBe("https://login.microsoftonline.com/example.onmicrosoft.com/oauth2/v2.0/devicecode");
    expect(config.auth.tokenUrl).toBe("https://login.microsoftonline.com/example.onmicrosoft.com/oauth2/v2.0/token");
    expect(config.auth.scope).toContain("https://graph.microsoft.com/Calendars.ReadWrite");
    expect(config.auth.scope).not.toContain("EWS");
    expect(config.auth.clientSecret).toBeUndefined();
  });
  it("uses explicitly configured scopes with any client ID", () => {
    const parsed = parseGraphConfig({ clientId, scope: " openid  profile offline_access " });
    expect(graphDeviceConfig(parsed).auth.scope).toBe("openid profile offline_access");
  });
  it.each(["", "x\nheader", "x\tvalue", "x".repeat(4097), 42])("rejects malformed scopes", (scope) => {
    expect(() => parseGraphConfig({ clientId, scope })).toThrow();
  });
  it.each(["../evil", "evil/path", "evil?x=y", "https://evil.test", "", "a\nheader"])("rejects unsafe tenant %s", (tenant) => {
    expect(() => parseGraphConfig({ clientId, tenant })).toThrow();
  });
  it("requires an explicit valid client ID and discards browser tokens", () => {
    expect(() => parseGraphConfig({ tenant: "common" })).toThrow();
    expect(parseGraphConfig({ clientId, refreshToken: "injected" })).toEqual({ clientId, tenant: "common" });
  });
  it("refreshes with the per-credential Client ID and persists rotation", async () => {
    const stored: Record<string, unknown>[] = [];
    const database = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ clientId, tenant: "organizations" }]) }) }) }),
      update: () => ({ set: (value: Record<string, unknown>) => ({ where: () => { stored.push(value); return Promise.resolve(); } }) }),
    } as unknown as BunSQLDatabase;
    const fetcher = vi.fn().mockResolvedValue(Response.json({ access_token: "new-access", refresh_token: "rotated", expires_in: 3600, token_type: "Bearer", scope: "Calendars.ReadWrite" }));
    vi.stubGlobal("fetch", fetcher);
    const fallback = vi.fn();
    const refresh = createCoordinatedRefresher({ database, oauthCredentialId: "credential", calendarAccountId: "account", refreshLockStore: null, microsoft: true, rawRefresh: fallback });
    await refresh("old-refresh");
    expect(fallback).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://login.microsoftonline.com/organizations/oauth2/v2.0/token");
    const body = fetcher.mock.calls[0]?.[1].body as URLSearchParams;
    expect(body.get("client_id")).toBe(clientId);
    expect(body.has("client_secret")).toBe(false);
    expect(body.has("scope")).toBe(false);
    expect(body.get("refresh_token")).toBe("old-refresh");
    expect(stored[0]?.refreshToken).toBe("rotated");
  });
});
