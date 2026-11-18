import { PGlite } from "@electric-sql/pglite";
import {
  account as accountTable,
  user as userTable,
} from "@keeper.sh/database/auth-schema";
import { makeSignature } from "better-auth/crypto";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/index";

const BASE_URL = "http://localhost:3000";
const ISSUER_URL = "https://id.example.com";
const SECRET = "test-secret-for-sign-in-tokens-not-kept";
const OIDC_SUBJECT = "oidc-subject-1";
const ACCESS_TOKEN = "provider-access-token-value";
const REFRESH_TOKEN = "provider-refresh-token-value";
const ID_TOKEN = "provider.id-token.value";

const AUTH_DDL = `
create table "user" (
  "id" text primary key,
  "agentFeedbackEnabled" boolean not null default true,
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


const createOidcAuth = async () => {
  const client = new PGlite();
  await client.exec(AUTH_DDL);

  const database = drizzle(client);
  const { auth } = createAuth({
    baseUrl: BASE_URL,
    commercialMode: false,
    database: database as unknown as BunSQLDatabase,
    oidcClientId: "oidc-client-id",
    oidcClientSecret: "oidc-client-secret",
    oidcIssuerUrl: ISSUER_URL,
    secret: SECRET,
  });

  return { auth, database };
};

type OidcAuth = Awaited<ReturnType<typeof createOidcAuth>>;

const signInWithOidc = async (auth: OidcAuth["auth"]) => {
  const context = await auth.$context;

  return handleOAuthUserInfo({ context } as never, {
    account: {
      accessToken: ACCESS_TOKEN,
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      accountId: OIDC_SUBJECT,
      idToken: ID_TOKEN,
      providerId: "oidc",
      refreshToken: REFRESH_TOKEN,
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
      scope: "openid,profile,email",
    },
    userInfo: {
      email: "person@example.com",
      emailVerified: true,
      id: OIDC_SUBJECT,
      name: "Person",
    },
  } as never);
};

const readAccounts = (database: OidcAuth["database"]) =>
  database
    .select({
      accessToken: accountTable.accessToken,
      accessTokenExpiresAt: accountTable.accessTokenExpiresAt,
      accountId: accountTable.accountId,
      idToken: accountTable.idToken,
      providerId: accountTable.providerId,
      refreshToken: accountTable.refreshToken,
      refreshTokenExpiresAt: accountTable.refreshTokenExpiresAt,
      scope: accountTable.scope,
      userId: accountTable.userId,
    })
    .from(accountTable);

const WITHOUT_TOKENS = {
  accessToken: null,
  accessTokenExpiresAt: null,
  idToken: null,
  refreshToken: null,
  refreshTokenExpiresAt: null,
};

const createSessionCookie = async (auth: OidcAuth["auth"], userId: string): Promise<string> => {
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(userId, false);
  const signature = await makeSignature(session.token, SECRET);
  return `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signature}`)}`;
};

const request = (auth: OidcAuth["auth"], method: string, path: string, cookie: string) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      headers: { "content-type": "application/json", cookie, origin: BASE_URL },
      method,
      ...(method === "POST" && { body: "{}" }),
    }),
  );

type FetchInput = Parameters<typeof fetch>[0];

const readRequestOrigin = (input: FetchInput): string => {
  if (input instanceof Request) {
    return new URL(input.url).origin;
  }
  return new URL(String(input)).origin;
};

const stubProviderDiscovery = (): void => {
  vi.stubGlobal("fetch", (input: FetchInput) => {
    const origin = readRequestOrigin(input);
    if (origin !== ISSUER_URL) {
      return Promise.reject(new Error(`Unexpected request to ${origin}`));
    }
    return Promise.resolve(Response.json({
      authorization_endpoint: `${ISSUER_URL}/authorize`,
      end_session_endpoint: `${ISSUER_URL}/logout`,
      issuer: ISSUER_URL,
      jwks_uri: `${ISSUER_URL}/jwks`,
      token_endpoint: `${ISSUER_URL}/token`,
      userinfo_endpoint: `${ISSUER_URL}/userinfo`,
    }));
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tokens issued at a provider sign-in", () => {
  it("are not stored when the account is created", async () => {
    const { auth, database } = await createOidcAuth();

    await signInWithOidc(auth);

    const accounts = await readAccounts(database);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      ...WITHOUT_TOKENS,
      accountId: OIDC_SUBJECT,
      providerId: "oidc",
      scope: "openid,profile,email",
    });
    for (const token of [ACCESS_TOKEN, REFRESH_TOKEN, ID_TOKEN]) {
      expect(JSON.stringify(accounts)).not.toContain(token);
    }
  });

  it("are removed from an account that held them once that person signs in again", async () => {
    const { auth, database } = await createOidcAuth();
    await signInWithOidc(auth);
    await database
      .update(accountTable)
      .set({
        accessToken: "earlier-access-token",
        accessTokenExpiresAt: new Date(),
        idToken: "earlier-id-token",
        refreshToken: "earlier-refresh-token",
        refreshTokenExpiresAt: new Date(),
      })
      .where(eq(accountTable.providerId, "oidc"));

    await signInWithOidc(auth);

    const accounts = await readAccounts(database);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ ...WITHOUT_TOKENS, scope: "openid,profile,email" });
    const users = await database.select({ id: userTable.id }).from(userTable);
    expect(users).toHaveLength(1);
  });

  it("are not needed to list a person's linked providers", async () => {
    const { auth, database } = await createOidcAuth();
    await signInWithOidc(auth);
    const [account] = await readAccounts(database);
    const cookie = await createSessionCookie(auth, account?.userId ?? "");

    const response = await request(auth, "GET", "/list-accounts", cookie);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([
      { accountId: OIDC_SUBJECT, providerId: "oidc", scopes: ["openid", "profile", "email"] },
    ]);
  });

  it("are not needed to sign out, including when the provider publishes a logout endpoint", async () => {
    stubProviderDiscovery();
    const { auth, database } = await createOidcAuth();
    await signInWithOidc(auth);
    const [account] = await readAccounts(database);
    const cookie = await createSessionCookie(auth, account?.userId ?? "");

    const response = await request(auth, "POST", "/sign-out", cookie);

    expect(response.status).toBe(200);
    const body = await response.json() as { success: boolean; url?: string };
    expect(body.success).toBe(true);
    const logoutUrl = new URL(body.url ?? "");
    expect(`${logoutUrl.origin}${logoutUrl.pathname}`).toBe(`${ISSUER_URL}/logout`);
    expect(logoutUrl.searchParams.get("client_id")).toBe("oidc-client-id");
    expect(logoutUrl.searchParams.has("id_token_hint")).toBe(false);
    const session = await request(auth, "GET", "/get-session", cookie);
    expect(await session.json()).toBeNull();
  });
});
