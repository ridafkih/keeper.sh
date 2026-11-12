import { PGlite } from "@electric-sql/pglite";
import { session as sessionTable } from "@keeper.sh/database/auth-schema";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "../src/index";
import type { AuthRequestOutcome } from "../src/index";
import { mapOidcProfileToUser } from "../src/oidc";

const BASE_URL = "http://localhost:3000";
const SECRET = "test-secret-for-auth-lifecycle-observer";
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

const AUTH_DDL = `
create table "user" (
  "id" text primary key,
  "agentFeedbackEnabled" boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "email" text not null unique,
  "emailVerified" boolean not null default false,
  "image" text,
  "onboardingStatus" text not null default 'pending',
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

let outcomes: AuthRequestOutcome[] = [];
let createdUserIds: string[] = [];
let deletedUserIds: string[] = [];

beforeEach(() => {
  outcomes = [];
  createdUserIds = [];
  deletedUserIds = [];
});

const createObservedAuth = async () => {
  const client = new PGlite();
  await client.exec(AUTH_DDL);
  const database = drizzle(client);
  const { auth } = createAuth({
    baseUrl: BASE_URL,
    database: database as unknown as BunSQLDatabase,
    observer: {
      onRequestResolved: (outcome) => outcomes.push(outcome),
      onAuthLog: () => null,
      onUserCreated: (userId) => createdUserIds.push(userId),
      onUserDeleted: (userId) => deletedUserIds.push(userId),
    },
    oidcClientId: "oidc-client-id",
    oidcClientSecret: "oidc-client-secret",
    oidcIssuerUrl: "https://id.example.com",
    secret: SECRET,
  });
  return { auth, database };
};

type ObservedAuth = Awaited<ReturnType<typeof createObservedAuth>>;

const post = (auth: ObservedAuth["auth"], path: string, body: object, cookie?: string) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        origin: BASE_URL,
        ...(cookie && { cookie }),
      },
      method: "POST",
    }),
  );

const readSessionCookie = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .join("; ");

const signUp = async (auth: ObservedAuth["auth"]) => {
  const response = await post(auth, "/username-only/sign-up", {
    password: "a-long-enough-password",
    username: "person",
  });
  const body = (await response.json()) as { user: { id: string } };
  return { cookie: readSessionCookie(response), userId: body.user.id };
};

const ageEverySession = async (database: ObservedAuth["database"]) => {
  await database.update(sessionTable).set({ createdAt: new Date(Date.now() - TWO_DAYS_MS) });
};

describe("the auth observer", () => {
  it("reports who signed up, and that a user was created", async () => {
    const { auth } = await createObservedAuth();

    const { userId } = await signUp(auth);

    expect(createdUserIds).toEqual([userId]);
    expect(outcomes).toContainEqual({ errorCode: null, provider: "username", userId });
  });

  it("reports a user created by a provider sign-in", async () => {
    const { auth } = await createObservedAuth();
    const context = await auth.$context;
    const profile = { email: "person@example.com", name: "Person", sub: "subject-1" };

    await handleOAuthUserInfo({ context } as never, {
      account: { accessToken: "token", accountId: profile.sub, providerId: "oidc" },
      userInfo: { email: profile.email, id: profile.sub, ...mapOidcProfileToUser(profile, { trustEmailVerified: false }) },
    } as never);

    expect(createdUserIds).toHaveLength(1);
  });

  it("reports the user and the reason when a stale session cannot delete the account", async () => {
    const { auth, database } = await createObservedAuth();
    const { cookie, userId } = await signUp(auth);
    await ageEverySession(database);

    const response = await post(auth, "/delete-user", {}, cookie);

    expect(response.status).toBe(400);
    expect(outcomes.at(-1)).toEqual({ errorCode: "SESSION_EXPIRED", provider: null, userId });
    expect(deletedUserIds).toEqual([]);
  });

  it("deletes the account once the user has signed in again, and reports it", async () => {
    const { auth, database } = await createObservedAuth();
    const { userId } = await signUp(auth);
    await ageEverySession(database);
    const signIn = await post(auth, "/username-only/sign-in", {
      password: "a-long-enough-password",
      username: "person",
    });

    const response = await post(auth, "/delete-user", {}, readSessionCookie(signIn));

    expect(response.status).toBe(200);
    expect(deletedUserIds).toEqual([userId]);
    expect(outcomes.at(-1)).toEqual({ errorCode: null, provider: null, userId });
  });
});
