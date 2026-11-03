import { PGlite } from "@electric-sql/pglite";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { createAuth, routeOidcCallbackRequest } from "../src/index";

const BASE_URL = "http://localhost:3000";
const REGISTERED_CALLBACK_URL = `${BASE_URL}/api/auth/oauth2/callback/oidc`;

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
`;

const servers: { stop: (force: boolean) => unknown }[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

const startIdentityProvider = (): string => {
  const server = Bun.serve({
    fetch: (request) => {
      const issuer = new URL(request.url).origin;
      return Response.json({
        authorization_endpoint: `${issuer}/authorize`,
        issuer,
        jwks_uri: `${issuer}/jwks`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
      });
    },
    port: 0,
  });
  servers.push(server);
  return `http://localhost:${server.port}`;
};

const createOidcAuth = async (issuerUrl: string) => {
  const client = new PGlite();
  await client.exec(AUTH_DDL);
  const { auth } = createAuth({
    baseUrl: BASE_URL,
    database: drizzle(client) as unknown as BunSQLDatabase,
    oidcClientId: "oidc-client-id",
    oidcClientSecret: "oidc-client-secret",
    oidcIssuerUrl: issuerUrl,
    secret: "test-secret-for-oidc-callback-url",
  });
  return auth;
};

describe("the OIDC callback URL", () => {
  it("stays the one self-hosters registered with their identity provider", async () => {
    const auth = await createOidcAuth(startIdentityProvider());

    const response = await auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/social`, {
        body: JSON.stringify({ callbackURL: "/", provider: "oidc" }),
        headers: { "content-type": "application/json", origin: BASE_URL },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    const { url } = (await response.json()) as { url: string };
    expect(new URL(url).searchParams.get("redirect_uri")).toBe(REGISTERED_CALLBACK_URL);
  });

  it("reaches the sign-in callback handler", async () => {
    const auth = await createOidcAuth(startIdentityProvider());

    const response = await auth.handler(
      routeOidcCallbackRequest(new Request(`${REGISTERED_CALLBACK_URL}?code=code&state=unknown`)),
    );

    expect(response.status).toBe(302);
  });

  it("leaves every other auth request untouched", () => {
    const request = new Request(`${BASE_URL}/api/auth/callback/google?code=code`);

    expect(routeOidcCallbackRequest(request)).toBe(request);
  });
});
