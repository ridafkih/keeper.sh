import { PGlite } from "@electric-sql/pglite";
import {
  account as accountTable,
  user as userTable,
  verification as verificationTable,
} from "@keeper.sh/database/auth-schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/index";

const BASE_URL = "http://localhost:3000";
const SECRET = "test-secret-for-repeat-sign-up-on-an-unverified-registration";
const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const OWNER_EMAIL = "owner@keeper.sh";
const OWNER_NAME = "Mailbox Owner";
const OWNER_PASSWORD = "mailbox-owner-password";
const REPEAT_NAME = "Repeat Sign-up";
const REPEAT_PASSWORD = "repeat-sign-up-password";

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

interface SentEmail {
  to: string;
  template: { variables: { url: string } };
}

type FetchInput = Parameters<typeof fetch>[0];

const readFetchUrl = (input: FetchInput): string => {
  if (input instanceof Request) {
    return input.url;
  }

  return String(input);
};

const captureSentEmails = (): SentEmail[] => {
  const sent: SentEmail[] = [];
  const realFetch = globalThis.fetch;

  vi.stubGlobal("fetch", (input: FetchInput, init?: RequestInit) => {
    if (readFetchUrl(input) !== RESEND_EMAILS_URL) {
      return realFetch(input, init);
    }

    sent.push(JSON.parse(String(init?.body)) as SentEmail);

    return Promise.resolve(Response.json({ id: crypto.randomUUID() }));
  });

  return sent;
};

const createHostedAuth = async () => {
  const client = new PGlite();
  await client.exec(AUTH_DDL);

  const database = drizzle(client);
  const { auth } = createAuth({
    baseUrl: BASE_URL,
    commercialMode: true,
    database: database as unknown as BunSQLDatabase,
    resendApiKey: "re_test_key",
    secret: SECRET,
  });

  return { auth, database };
};

type HostedAuth = Awaited<ReturnType<typeof createHostedAuth>>["auth"];
type HostedDatabase = Awaited<ReturnType<typeof createHostedAuth>>["database"];

const postJson = (auth: HostedAuth, path: string, body: Record<string, string>) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", origin: BASE_URL },
      method: "POST",
    }),
  );

const signUp = (auth: HostedAuth, email: string, name: string, password: string) =>
  postJson(auth, "/sign-up/email", { email, name, password });

const signIn = (auth: HostedAuth, password: string) =>
  postJson(auth, "/sign-in/email", { email: OWNER_EMAIL, password });

const followVerificationLink = (auth: HostedAuth, email: SentEmail) => {
  const link = new URL(email.template.variables.url);
  link.searchParams.delete("callbackURL");

  return auth.handler(
    new Request(link.toString(), { headers: { origin: BASE_URL }, method: "GET" }),
  );
};

const readOwner = async (database: HostedDatabase) => {
  const [owner] = await database
    .select()
    .from(userTable)
    .where(eq(userTable.email, OWNER_EMAIL));

  return owner;
};

const readAccounts = (database: HostedDatabase) => database.select().from(accountTable);

const readVerificationIdentifiers = async (database: HostedDatabase) => {
  const rows = await database
    .select({ identifier: verificationTable.identifier })
    .from(verificationTable);

  return rows.map(({ identifier }) => identifier);
};

const describeSignUpResponse = async (response: Response) => {
  const body = (await response.json()) as { token: unknown; user: Record<string, unknown> };

  return {
    status: response.status,
    token: body.token,
    userFields: Object.keys(body.user).toSorted(),
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a repeat sign-up for a registered but unverified address", () => {
  it("leaves the mailbox owner's password in place after they verify", async () => {
    const sent = captureSentEmails();
    const { auth, database } = await createHostedAuth();

    const ownerSignUp = await signUp(auth, OWNER_EMAIL, OWNER_NAME, OWNER_PASSWORD);
    expect(ownerSignUp.status).toBe(200);

    const repeatSignUp = await signUp(auth, OWNER_EMAIL, REPEAT_NAME, REPEAT_PASSWORD);
    expect(repeatSignUp.status).toBe(200);

    const resent = sent.at(-1);
    if (!resent) {
      throw new Error("No verification email was resent");
    }

    const verification = await followVerificationLink(auth, resent);
    expect(verification.status).toBe(200);
    expect(verification.headers.get("set-cookie")).toContain("session_token");

    const owner = await readOwner(database);
    expect(owner?.emailVerified).toBe(true);
    expect(owner?.name).toBe(OWNER_NAME);

    const repeatSignIn = await signIn(auth, REPEAT_PASSWORD);
    expect(repeatSignIn.status).toBe(401);

    const ownerSignIn = await signIn(auth, OWNER_PASSWORD);
    expect(ownerSignIn.status).toBe(200);
  });

  it("resends verification and answers exactly as a first sign-up does", async () => {
    const sent = captureSentEmails();
    const { auth } = await createHostedAuth();

    const firstSignUp = await signUp(auth, OWNER_EMAIL, OWNER_NAME, OWNER_PASSWORD);
    const repeatSignUp = await signUp(auth, OWNER_EMAIL, REPEAT_NAME, REPEAT_PASSWORD);
    const freshSignUp = await signUp(auth, "fresh@keeper.sh", REPEAT_NAME, REPEAT_PASSWORD);

    const expected = await describeSignUpResponse(freshSignUp);
    expect(await describeSignUpResponse(firstSignUp)).toEqual(expected);
    expect(await describeSignUpResponse(repeatSignUp)).toEqual(expected);

    expect(sent.map(({ to }) => to)).toEqual([OWNER_EMAIL, OWNER_EMAIL, "fresh@keeper.sh"]);
  });

  it("stores nothing from the repeat sign-up", async () => {
    captureSentEmails();
    const { auth, database } = await createHostedAuth();

    await signUp(auth, OWNER_EMAIL, OWNER_NAME, OWNER_PASSWORD);
    const ownerBefore = await readOwner(database);
    const accountsBefore = await readAccounts(database);
    const identifiersBefore = await readVerificationIdentifiers(database);

    await signUp(auth, OWNER_EMAIL, REPEAT_NAME, REPEAT_PASSWORD);

    expect(await readOwner(database)).toEqual(ownerBefore);
    expect(await readAccounts(database)).toEqual(accountsBefore);
    expect(await readVerificationIdentifiers(database)).toEqual(identifiersBefore);
  });
});
