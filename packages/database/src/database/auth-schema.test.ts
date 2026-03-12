import { describe, expect, it } from "bun:test";
import * as authSchema from "./auth-schema";

describe("oauth provider schema", () => {
  it("exports the Better Auth OAuth provider tables", () => {
    const schema = authSchema as Record<string, unknown>;

    expect(schema.oauthClient).toBeDefined();
    expect(schema.oauthRefreshToken).toBeDefined();
    expect(schema.oauthAccessToken).toBeDefined();
    expect(schema.oauthConsent).toBeDefined();
    expect(schema.jwks).toBeDefined();
  });

  it("includes the OAuth client registration fields", () => {
    const oauthClient = (authSchema as Record<string, any>).oauthClient;

    expect(oauthClient.id).toBeDefined();
    expect(oauthClient.redirectUris).toBeDefined();
    expect(oauthClient.tokenEndpointAuthMethod).toBeDefined();
    expect(oauthClient.grantTypes).toBeDefined();
    expect(oauthClient.responseTypes).toBeDefined();
    expect(oauthClient.public).toBeDefined();
    expect(oauthClient.requirePKCE).toBeDefined();
    expect(oauthClient.skipConsent).toBeDefined();
  });

  it("includes opaque access token identifiers and refresh linkage", () => {
    const oauthAccessToken = (authSchema as Record<string, any>).oauthAccessToken;

    expect(oauthAccessToken.id).toBeDefined();
    expect(oauthAccessToken.token).toBeDefined();
    expect(oauthAccessToken.refreshId).toBeDefined();
    expect(oauthAccessToken.expiresAt).toBeDefined();
  });

  it("includes refresh token storage for offline access", () => {
    const oauthRefreshToken = (authSchema as Record<string, any>).oauthRefreshToken;

    expect(oauthRefreshToken.id).toBeDefined();
    expect(oauthRefreshToken.token).toBeDefined();
    expect(oauthRefreshToken.sessionId).toBeDefined();
    expect(oauthRefreshToken.expiresAt).toBeDefined();
    expect(oauthRefreshToken.authTime).toBeDefined();
  });

  it("includes consent ids and reference-aware fields", () => {
    const oauthConsent = (authSchema as Record<string, any>).oauthConsent;

    expect(oauthConsent.id).toBeDefined();
    expect(oauthConsent.referenceId).toBeDefined();
    expect(oauthConsent.scopes).toBeDefined();
  });

  it("includes JWT key storage for signed access tokens", () => {
    const jwks = (authSchema as Record<string, any>).jwks;

    expect(jwks.id).toBeDefined();
    expect(jwks.publicKey).toBeDefined();
    expect(jwks.privateKey).toBeDefined();
    expect(jwks.createdAt).toBeDefined();
  });
});
