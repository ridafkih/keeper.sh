import { PGlite } from "@electric-sql/pglite";
import { user as userTable } from "@keeper.sh/database/auth-schema";
import { signJWT } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/index";

const BASE_URL = "http://localhost:3000";
const SECRET = "test-secret-for-abandoned-unverified-registration-reclaim";
const OWNER_EMAIL = "owner@keeper.sh";
const ABANDONED_PASSWORD = "abandoned-registration-password";
const RECLAIMED_PASSWORD = "reclaimed-registration-password";

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

const createHostedAuth = async () => {
  const client = new PGlite();
  await client.exec(AUTH_DDL);

  const database = drizzle(client);
  const { auth } = createAuth({
    deleteUserResidueRecorder: async () => {},
    deleteUserTeardown: async () => {},
    deleteUserTeardownRollback: async () => {},
    baseUrl: BASE_URL,
    commercialMode: true,
    database: database as unknown as BunSQLDatabase,
    secret: SECRET,
  });

  return { auth, database };
};

const postJson = (
  auth: Awaited<ReturnType<typeof createHostedAuth>>["auth"],
  path: string,
  body: Record<string, string>,
) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", origin: BASE_URL },
      method: "POST",
    }),
  );

const signUp = (
  auth: Awaited<ReturnType<typeof createHostedAuth>>["auth"],
  name: string,
  password: string,
) => postJson(auth, "/sign-up/email", { email: OWNER_EMAIL, name, password });

const completeEmailVerification = async (
  auth: Awaited<ReturnType<typeof createHostedAuth>>["auth"],
) => {
  const token = await signJWT({ email: OWNER_EMAIL }, SECRET, 3600);

  return auth.handler(
    new Request(`${BASE_URL}/api/auth/verify-email?token=${token}`, {
      headers: { origin: BASE_URL },
      method: "GET",
    }),
  );
};

describe("an abandoned unverified registration can still be reclaimed by its owner", () => {
  it("lets the owner sign up again, verify, and use the account on that address", async () => {
    const { auth, database } = await createHostedAuth();

    const abandonedResponse = await signUp(auth, "Abandoned Registration", ABANDONED_PASSWORD);
    expect(abandonedResponse.status).toBe(200);

    const abandonedRows = await database
      .select()
      .from(userTable)
      .where(eq(userTable.email, OWNER_EMAIL));
    expect(abandonedRows).toHaveLength(1);
    expect(abandonedRows[0]?.emailVerified).toBe(false);

    const reclaimResponse = await signUp(auth, "Returning Owner", RECLAIMED_PASSWORD);
    expect(reclaimResponse.status).toBe(200);

    const verificationResponse = await completeEmailVerification(auth);
    expect(verificationResponse.status).toBe(200);

    const reclaimedRows = await database
      .select()
      .from(userTable)
      .where(eq(userTable.email, OWNER_EMAIL));
    expect(reclaimedRows).toHaveLength(1);
    expect(reclaimedRows[0]?.emailVerified).toBe(true);

    const signInResponse = await postJson(auth, "/sign-in/email", {
      email: OWNER_EMAIL,
      password: RECLAIMED_PASSWORD,
    });
    expect(signInResponse.status).toBe(200);
  });
});
