import { PGlite } from "@electric-sql/pglite";
import type { SignUpAttribution } from "@keeper.sh/data-schemas";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/index";

const BASE_URL = "http://localhost:3000";
const SECRET = "test-secret-for-sign-up-attribution";

const AUTH_DDL = `
create table "user" (
  "id" text primary key,
  "agentFeedbackEnabled" boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "email" text not null unique,
  "emailVerified" boolean not null default false,
  "image" text,
  "name" text not null,
  "onboardingStatus" text not null default 'pending',
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

interface CreatedUser {
  userId: string;
  attribution: SignUpAttribution | null;
}

let createdUsers: CreatedUser[] = [];

beforeEach(() => {
  createdUsers = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const createAttributedAuth = async () => {
  const client = new PGlite();
  await client.exec(AUTH_DDL);
  const { auth } = createAuth({
    baseUrl: BASE_URL,
    commercialMode: true,
    database: drizzle(client) as unknown as BunSQLDatabase,
    googleClientId: "test-google-client-id",
    googleClientSecret: "test-google-client-secret",
    observer: {
      onAuthLog: () => null,
      onRequestResolved: () => null,
      onUserCreated: (userId, attribution) => createdUsers.push({ attribution, userId }),
      onUserDeleted: () => null,
    },
    secret: SECRET,
  });
  return auth;
};

type AttributedAuth = Awaited<ReturnType<typeof createAttributedAuth>>;

const post = (auth: AttributedAuth, path: string, body: object) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", origin: BASE_URL },
      method: "POST",
    }),
  );

const readCookies = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .join("; ");

const encodeSegment = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

const buildIdToken = (claims: Record<string, unknown>) =>
  `${encodeSegment({ alg: "RS256", kid: "test-kid", typ: "JWT" })}.${encodeSegment(claims)}.signature`;

const answerGoogleTokenExchange = () => {
  const idToken = buildIdToken({
    aud: "test-google-client-id",
    email: "person@example.com",
    email_verified: true,
    iss: "https://accounts.google.com",
    name: "Person",
    sub: "google-subject-1",
  });
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json({
    access_token: "test-access-token",
    expires_in: 3600,
    id_token: idToken,
    token_type: "Bearer",
  }))));
};

const signUpWithGoogle = async (auth: AttributedAuth, additionalData?: object) => {
  const start = await post(auth, "/sign-in/social", {
    callbackURL: "/dashboard",
    provider: "google",
    ...(additionalData && { additionalData }),
  });
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state") ?? "";
  answerGoogleTokenExchange();

  return auth.handler(
    new Request(`${BASE_URL}/api/auth/callback/google?code=test-code&state=${state}`, {
      headers: { cookie: readCookies(start) },
    }),
  );
};

describe("sign-up attribution", () => {
  it("reaches the observer from an email sign-up", async () => {
    const auth = await createAttributedAuth();

    await post(auth, "/sign-up/email", {
      attribution: { landingPath: "/compare/onecal", referrerOrigin: "https://www.google.com" },
      email: "person@example.com",
      name: "person",
      password: "a-long-enough-password",
    });

    expect(createdUsers).toEqual([{
      attribution: { landingPath: "/compare/onecal", referrerOrigin: "https://www.google.com" },
      userId: expect.any(String),
    }]);
  });

  it("drops what fails validation from an email sign-up", async () => {
    const auth = await createAttributedAuth();

    await post(auth, "/sign-up/email", {
      attribution: { landingPath: "not-a-path", utmSource: "x".repeat(500) },
      email: "person@example.com",
      name: "person",
      password: "a-long-enough-password",
    });

    expect(createdUsers.map(({ attribution }) => attribution)).toEqual([null]);
  });

  it("survives the Google redirect and reaches the observer", async () => {
    const auth = await createAttributedAuth();

    const callback = await signUpWithGoogle(auth, {
      attribution: { landingPath: "/blog/sync-outlook", utmMedium: "cpc", utmSource: "google" },
    });

    expect(callback.status).toBe(302);
    expect(createdUsers).toEqual([{
      attribution: { landingPath: "/blog/sync-outlook", utmMedium: "cpc", utmSource: "google" },
      userId: expect.any(String),
    }]);
  });

  it("reports no attribution for a Google sign-up that carried none", async () => {
    const auth = await createAttributedAuth();

    await signUpWithGoogle(auth);

    expect(createdUsers.map(({ attribution }) => attribution)).toEqual([null]);
  });
});
