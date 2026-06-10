import { describe, expect, it } from "vitest";
import {
  jwks,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
} from "../../src/database/auth-schema";

describe("oauth provider schema", () => {
  it("exports the Better Auth OAuth provider tables", () => {
    expect(oauthClient).toBeDefined();
    expect(oauthRefreshToken).toBeDefined();
    expect(oauthAccessToken).toBeDefined();
    expect(oauthConsent).toBeDefined();
    expect(jwks).toBeDefined();
  });

  it("includes the OAuth client registration fields", () => {
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
    expect(oauthAccessToken.id).toBeDefined();
    expect(oauthAccessToken.token).toBeDefined();
    expect(oauthAccessToken.refreshId).toBeDefined();
    expect(oauthAccessToken.expiresAt).toBeDefined();
  });

  it("includes refresh token storage for offline access", () => {
    expect(oauthRefreshToken.id).toBeDefined();
    expect(oauthRefreshToken.token).toBeDefined();
    expect(oauthRefreshToken.sessionId).toBeDefined();
    expect(oauthRefreshToken.expiresAt).toBeDefined();
    expect(oauthRefreshToken.authTime).toBeDefined();
  });

  it("includes consent ids and reference-aware fields", () => {
    expect(oauthConsent.id).toBeDefined();
    expect(oauthConsent.referenceId).toBeDefined();
    expect(oauthConsent.scopes).toBeDefined();
  });

  it("includes JWT key storage for signed access tokens", () => {
    expect(jwks.id).toBeDefined();
    expect(jwks.publicKey).toBeDefined();
    expect(jwks.privateKey).toBeDefined();
    expect(jwks.createdAt).toBeDefined();
  });
});
