import { PGlite } from "@electric-sql/pglite";
import { user as userTable } from "@keeper.sh/database/auth-schema";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/index";

const BASE_URL = "http://localhost:3000";
const SECRET = "test-secret-for-registration-email-domains";

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

const createRestrictedAuth = async (registrationEmailDomains?: string[]) => {
  const client = new PGlite();
  await client.exec(AUTH_DDL);

  const database = drizzle(client);
  const { auth } = createAuth({
    baseUrl: BASE_URL,
    commercialMode: true,
    database: database as unknown as BunSQLDatabase,
    googleClientId: "test-google-client-id",
    googleClientSecret: "test-google-client-secret",
    secret: SECRET,
    ...(registrationEmailDomains && { registrationEmailDomains }),
  });

  return { auth, database };
};

const signUp = (auth: Awaited<ReturnType<typeof createRestrictedAuth>>["auth"], email: string) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      body: JSON.stringify({ email, name: "Registrant", password: "a-long-enough-password" }),
      headers: { "content-type": "application/json", origin: BASE_URL },
      method: "POST",
    }),
  );

const readUserEmails = async (
  database: Awaited<ReturnType<typeof createRestrictedAuth>>["database"],
) => {
  const users = await database.select({ email: userTable.email }).from(userTable);
  return users.map(({ email }) => email);
};

describe("registration limited to approved email domains", () => {
  it("refuses an email sign-up from another domain and creates no account", async () => {
    const { auth, database } = await createRestrictedAuth(["keeper.sh"]);

    const response = await signUp(auth, "someone@example.com");

    expect(response.status).toBe(403);
    expect(await readUserEmails(database)).toEqual([]);
  });

  it("accepts an email sign-up from an approved domain regardless of case", async () => {
    const { auth, database } = await createRestrictedAuth(["keeper.sh"]);

    const response = await signUp(auth, "Someone@Keeper.SH");

    expect(response.status).toBe(200);
    expect(await readUserEmails(database)).toEqual(["someone@keeper.sh"]);
  });

  it("does not treat a lookalike subdomain as the approved domain", async () => {
    const { auth } = await createRestrictedAuth(["keeper.sh"]);

    const response = await signUp(auth, "someone@keeper.sh.example.com");

    expect(response.status).toBe(403);
  });

  it("refuses a first-time provider sign-in from another domain", async () => {
    const { auth, database } = await createRestrictedAuth(["keeper.sh"]);
    const context = await auth.$context;

    await expect(
      context.internalAdapter.createOAuthUser(
        { email: "someone@example.com", emailVerified: true, name: "Registrant" },
        { accountId: "google-subject", providerId: "google" },
      ),
    ).rejects.toThrow("Registration is limited to approved email domains");
    expect(await readUserEmails(database)).toEqual([]);
  });

  it("lets any domain register when no domains are configured", async () => {
    const { auth, database } = await createRestrictedAuth();

    const response = await signUp(auth, "someone@example.com");

    expect(response.status).toBe(200);
    expect(await readUserEmails(database)).toEqual(["someone@example.com"]);
  });
});
