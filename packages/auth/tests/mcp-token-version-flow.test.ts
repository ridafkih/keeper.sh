import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/index";

const AUTH_DDL = `
create table "user" (
  "id" text primary key,
  "createdAt" timestamptz not null default now(),
  "email" text not null unique,
  "emailVerified" boolean not null default false,
  "image" text,
  "name" text not null,
  "updatedAt" timestamptz not null default now(),
  "username" text unique
);
create table "session" (
  "id" text primary key,
  "createdAt" timestamptz not null default now(),
  "expiresAt" timestamptz not null,
  "ipAddress" text,
  "token" text not null unique,
  "updatedAt" timestamptz not null default now(),
  "userAgent" text,
  "userId" text not null references "user"("id") on delete cascade
);
create table "account" (
  "id" text primary key,
  "accessToken" text,
  "accessTokenExpiresAt" timestamptz,
  "accountId" text not null,
  "createdAt" timestamptz not null default now(),
  "idToken" text,
  "password" text,
  "providerId" text not null,
  "refreshToken" text,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "updatedAt" timestamptz not null default now(),
  "userId" text not null references "user"("id") on delete cascade
);
create table "verification" (
  "id" text primary key,
  "createdAt" timestamptz not null default now(),
  "expiresAt" timestamptz not null,
  "identifier" text not null,
  "updatedAt" timestamptz not null default now(),
  "value" text not null
);
create table "jwks" (
  "id" text primary key,
  "publicKey" text not null,
  "privateKey" text not null,
  "createdAt" timestamptz not null default now(),
  "expiresAt" timestamptz
);
create table "oauth_application" (
  "id" text primary key,
  "clientId" text not null unique,
  "clientSecret" text,
  "disabled" boolean not null default false,
  "skipConsent" boolean,
  "enableEndSession" boolean,
  "subjectType" text,
  "scopes" text[],
  "userId" text references "user"("id") on delete cascade,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "expiresAt" timestamptz,
  "name" text,
  "uri" text,
  "icon" text,
  "contacts" text[],
  "tos" text,
  "policy" text,
  "softwareId" text,
  "softwareVersion" text,
  "softwareStatement" text,
  "redirectUris" text[] not null,
  "postLogoutRedirectUris" text[],
  "tokenEndpointAuthMethod" text,
  "grantTypes" text[],
  "responseTypes" text[],
  "public" boolean,
  "type" text,
  "requirePKCE" boolean,
  "referenceId" text,
  "metadata" text
);
create table "oauth_refresh_token" (
  "id" text primary key,
  "token" text not null unique,
  "clientId" text not null references "oauth_application"("clientId") on delete cascade,
  "sessionId" text references "session"("id") on delete set null,
  "userId" text not null references "user"("id") on delete cascade,
  "referenceId" text,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default now(),
  "revoked" timestamptz,
  "authTime" timestamptz,
  "scopes" text[] not null
);
create table "oauth_access_token" (
  "id" text primary key,
  "token" text not null unique,
  "clientId" text not null references "oauth_application"("clientId") on delete cascade,
  "sessionId" text references "session"("id") on delete set null,
  "userId" text references "user"("id") on delete cascade,
  "referenceId" text,
  "refreshId" text references "oauth_refresh_token"("id") on delete set null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default now(),
  "scopes" text[] not null
);
create table "oauth_consent" (
  "id" text primary key,
  "clientId" text not null references "oauth_application"("clientId") on delete cascade,
  "userId" text not null references "user"("id") on delete cascade,
  "referenceId" text,
  "scopes" text[] not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
`;

const MARK_EXISTING_CLIENTS_LEGACY_SQL = readFileSync(
  join(
    import.meta.dirname,
    "../../database/drizzle/0095_mark_existing_oauth_clients_legacy.sql",
  ),
  "utf8",
);

const REDIRECT_URI = "https://client.example/callback";
const REQUESTED_SCOPE = "openid offline_access keeper.read keeper.write";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
}

const respondUnavailable = (): Promise<Response> =>
  Promise.resolve(new Response(null, { status: 503 }));

const readTokenVersion = (accessToken: string): unknown => {
  const [, payload = ""] = accessToken.split(".");
  const claims: Record<string, unknown> = JSON.parse(Buffer.from(payload, "base64url").toString());
  return claims.keeper_token_version;
};

const toCookieHeader = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

const readClientId = async (response: Response): Promise<string> => {
  expect(response.status).toBe(200);
  const { client_id: clientId } = (await response.json()) as { client_id: string };
  return clientId;
};

const createHarness = async () => {
  const pglite = new PGlite();
  await pglite.exec(AUTH_DDL);
  const database = drizzle(pglite);

  const router: { handle: (request: Request) => Promise<Response> } = { handle: respondUnavailable };
  const server = Bun.serve({ fetch: (request) => router.handle(request), port: 0 });
  const baseUrl = `http://localhost:${server.port}`;
  const resource = `${baseUrl}/mcp`;

  const { auth } = createAuth({
    baseUrl,
    database: database as unknown as BunSQLDatabase,
    mcpResourceUrl: resource,
    secret: "mcp-token-version-flow-secret-value",
    trustedOrigins: [baseUrl],
  });
  router.handle = (request) => auth.handler(request);

  const postJson = (path: string, body: object, cookie = "") =>
    fetch(`${baseUrl}/api/auth${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", cookie, origin: baseUrl },
      method: "POST",
    });

  const postForm = (path: string, fields: Record<string, string>) =>
    fetch(`${baseUrl}/api/auth${path}`, {
      body: new URLSearchParams(fields),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });

  const signUp = await postJson("/username-only/sign-up", {
    password: "a-long-enough-password",
    username: "token-owner",
  });
  expect(signUp.status).toBe(200);
  const sessionCookie = toCookieHeader(signUp);

  const registerClient = async (body: object): Promise<string> =>
    readClientId(
      await postJson("/oauth2/register", {
        client_name: "Test Client",
        grant_types: ["authorization_code", "refresh_token"],
        redirect_uris: [REDIRECT_URI],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        ...body,
      }),
    );

  const createClientAsUser = async (body: object): Promise<string> =>
    readClientId(
      await postJson(
        "/oauth2/create-client",
        {
          client_name: "Owned Client",
          grant_types: ["authorization_code", "refresh_token"],
          redirect_uris: [REDIRECT_URI],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          ...body,
        },
        sessionCookie,
      ),
    );

  const issueTokens = async (clientId: string): Promise<TokenResponse> => {
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const authorizeUrl = new URL(`${baseUrl}/api/auth/oauth2/authorize`);
    authorizeUrl.search = new URLSearchParams({
      client_id: clientId,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      redirect_uri: REDIRECT_URI,
      resource,
      response_type: "code",
      scope: REQUESTED_SCOPE,
      state: "state",
    }).toString();

    const authorize = await fetch(authorizeUrl, {
      headers: { cookie: sessionCookie },
      redirect: "manual",
    });
    const consentLocation = new URL(authorize.headers.get("location") ?? "", baseUrl);
    expect(consentLocation.pathname).toBe("/oauth/consent");

    const consent = await postJson(
      "/oauth2/consent",
      { accept: true, oauth_query: consentLocation.search.slice(1) },
      sessionCookie,
    );
    const { url } = (await consent.json()) as { url: string };
    const code = new URL(url).searchParams.get("code") ?? "";

    const token = await postForm("/oauth2/token", {
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
      resource,
    });
    expect(token.status).toBe(200);
    return (await token.json()) as TokenResponse;
  };

  const refreshTokens = async (clientId: string, refreshToken: string): Promise<TokenResponse> => {
    const token = await postForm("/oauth2/token", {
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      resource,
    });
    expect(token.status).toBe(200);
    return (await token.json()) as TokenResponse;
  };

  const readSession = (accessToken: string) => {
    if (!("getMcpSession" in auth.api) || typeof auth.api.getMcpSession !== "function") {
      throw new TypeError("Expected MCP auth to be enabled");
    }
    return auth.api.getMcpSession({
      headers: new Headers({ authorization: `Bearer ${accessToken}` }),
    });
  };

  const markExistingClientsLegacy = () => pglite.exec(MARK_EXISTING_CLIENTS_LEGACY_SQL);

  const stop = () => server.stop(true);

  return {
    createClientAsUser,
    issueTokens,
    markExistingClientsLegacy,
    readSession,
    refreshTokens,
    registerClient,
    stop,
  };
};

describe("MCP token versions", () => {
  it("issues version 2 tokens to a client registered now, even when it asks for version 1", async () => {
    const harness = await createHarness();
    try {
      const clientId = await harness.registerClient({
        keeper_token_version: 1,
        metadata: { keeper_token_version: 1 },
      });

      const tokens = await harness.issueTokens(clientId);

      expect(readTokenVersion(tokens.access_token)).toBe(2);
      expect(await harness.readSession(tokens.access_token)).toMatchObject({
        scopes: REQUESTED_SCOPE,
        tokenVersion: 2,
      });

      const refreshed = await harness.refreshTokens(clientId, tokens.refresh_token);
      expect(readTokenVersion(refreshed.access_token)).toBe(2);
    } finally {
      await harness.stop();
    }
  });

  it("issues version 2 tokens to a client a signed-in user creates with version 1 metadata", async () => {
    const harness = await createHarness();
    try {
      const clientId = await harness.createClientAsUser({ metadata: { keeper_token_version: 1 } });

      const tokens = await harness.issueTokens(clientId);

      expect(readTokenVersion(tokens.access_token)).toBe(2);
    } finally {
      await harness.stop();
    }
  });

  it("keeps issuing version 1 tokens, refreshes included, to a client that existed before versioning", async () => {
    const harness = await createHarness();
    try {
      const clientId = await harness.registerClient({});
      await harness.markExistingClientsLegacy();

      const tokens = await harness.issueTokens(clientId);

      expect(readTokenVersion(tokens.access_token)).toBe(1);
      expect(await harness.readSession(tokens.access_token)).toMatchObject({ tokenVersion: 1 });

      const refreshed = await harness.refreshTokens(clientId, tokens.refresh_token);
      expect(readTokenVersion(refreshed.access_token)).toBe(1);
    } finally {
      await harness.stop();
    }
  });
});
