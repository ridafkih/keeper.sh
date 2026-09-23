import { PGlite } from "@electric-sql/pglite";
import {
  account as accountTable,
  user as userTable,
} from "@keeper.sh/database/auth-schema";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/index";

const BASE_URL = "http://localhost:3000";
const SECRET = "test-secret-for-microsoft-sign-in-account-linking";
const MICROSOFT_CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

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

const encodeSegment = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const buildIdToken = (claims: Record<string, unknown>) =>
  `${encodeSegment({ alg: "RS256", kid: "test-kid", typ: "JWT" })}.${encodeSegment(claims)}.signature`;

const createHostedAuth = async () => {
  const client = new PGlite();
  await client.exec(AUTH_DDL);

  const database = drizzle(client);
  const { auth } = createAuth({
    baseUrl: BASE_URL,
    commercialMode: true,
    database: database as unknown as BunSQLDatabase,
    microsoftClientId: "test-microsoft-client-id",
    microsoftClientSecret: "test-microsoft-client-secret",
    secret: SECRET,
  });

  return { auth, database };
};

type HostedAuth = Awaited<ReturnType<typeof createHostedAuth>>;

const signInWithMicrosoft = async (
  auth: HostedAuth["auth"],
  claims: Record<string, unknown>,
) => {
  const context = await auth.$context;
  const provider = context.socialProviders.find(
    (candidate) => candidate.id === "microsoft",
  );

  if (!provider) {
    throw new TypeError("Microsoft provider is not configured");
  }

  const profile = await provider.getUserInfo({
    accessToken: "test-access-token",
    idToken: buildIdToken(claims),
  } as never);

  if (!profile) {
    throw new TypeError("Microsoft provider returned no profile");
  }

  return handleOAuthUserInfo({ context } as never, {
    account: {
      accessToken: "test-access-token",
      accountId: String(profile.user.id),
      providerId: "microsoft",
    },
    userInfo: profile.user,
  } as never);
};

interface SeedCustomerParams {
  database: HostedAuth["database"];
  email: string;
  linkedMicrosoftSubject?: string;
  userId: string;
}

const seedVerifiedCustomer = async ({
  database,
  email,
  linkedMicrosoftSubject,
  userId,
}: SeedCustomerParams) => {
  await database.insert(userTable).values({
    email,
    emailVerified: true,
    id: userId,
    name: "Existing Customer",
  });

  if (linkedMicrosoftSubject) {
    await database.insert(accountTable).values({
      accountId: linkedMicrosoftSubject,
      id: `microsoft-account-${userId}`,
      providerId: "microsoft",
      userId,
    });
  }
};

const readMicrosoftAccounts = (database: HostedAuth["database"], userId: string) =>
  database
    .select({ accountId: accountTable.accountId })
    .from(accountTable)
    .where(eq(accountTable.userId, userId));

const readEmailVerified = async (database: HostedAuth["database"], userId: string) => {
  const [row] = await database
    .select({ emailVerified: userTable.emailVerified })
    .from(userTable)
    .where(eq(userTable.id, userId));
  return row?.emailVerified;
};

type FetchInput = Parameters<typeof fetch>[0];

const readFetchUrl = (input: FetchInput): string => {
  if (input instanceof Request) {
    return input.url;
  }

  return String(input);
};

const stubGraphPhotoFetch = () => {
  const realFetch = globalThis.fetch;

  vi.stubGlobal("fetch", (input: FetchInput, init?: RequestInit) => {
    if (readFetchUrl(input).startsWith("https://graph.microsoft.com/")) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }

    return realFetch(input, init);
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a Microsoft sign-in matching an existing customer's email", () => {
  it("is refused when Entra asserts nothing about the email", async () => {
    stubGraphPhotoFetch();

    const { auth, database } = await createHostedAuth();
    const email = "existing-customer@keeper.sh";
    await seedVerifiedCustomer({ database, email, userId: "existing-customer" });

    const result = await signInWithMicrosoft(auth, {
      email,
      name: "Unasserted Work Account",
      oid: "entra-object-id",
      sub: "unasserted-subject",
      tid: "contoso-tenant",
    });

    expect(result.error).toBe("account not linked");
    expect(await readMicrosoftAccounts(database, "existing-customer")).toEqual([]);
  });

  it("is refused when Entra states the email is unverified", async () => {
    stubGraphPhotoFetch();

    const { auth, database } = await createHostedAuth();
    const email = "existing-customer@keeper.sh";
    await seedVerifiedCustomer({ database, email, userId: "existing-customer" });

    const result = await signInWithMicrosoft(auth, {
      email,
      email_verified: false,
      name: "Unverified Account",
      oid: "entra-object-id",
      sub: "unverified-subject",
      tid: MICROSOFT_CONSUMER_TENANT_ID,
      xms_edov: true,
    });

    expect(result.error).toBe("account not linked");
    expect(await readMicrosoftAccounts(database, "existing-customer")).toEqual([]);
  });

  it("is linked when Entra marks the email domain owner verified", async () => {
    stubGraphPhotoFetch();

    const { auth, database } = await createHostedAuth();
    const email = "existing-customer@keeper.sh";
    await seedVerifiedCustomer({ database, email, userId: "existing-customer" });

    const result = await signInWithMicrosoft(auth, {
      email,
      name: "Domain Verified Work Account",
      oid: "entra-object-id",
      sub: "domain-verified-subject",
      tid: "contoso-tenant",
      xms_edov: true,
    });

    expect(result.error).toBeNull();
    expect(result.data?.user.id).toBe("existing-customer");
    expect(await readMicrosoftAccounts(database, "existing-customer")).toEqual([
      { accountId: "domain-verified-subject" },
    ]);
  });

  it("is linked for a personal Microsoft account", async () => {
    stubGraphPhotoFetch();

    const { auth, database } = await createHostedAuth();
    const email = "existing-customer@keeper.sh";
    await seedVerifiedCustomer({ database, email, userId: "existing-customer" });

    const result = await signInWithMicrosoft(auth, {
      email,
      name: "Personal Account",
      oid: "entra-object-id",
      sub: "personal-subject",
      tid: MICROSOFT_CONSUMER_TENANT_ID,
    });

    expect(result.error).toBeNull();
    expect(result.data?.user.id).toBe("existing-customer");
  });
});

describe("a Microsoft sign-in to an already linked account", () => {
  it("still signs in and keeps the email verified when Entra asserts nothing", async () => {
    stubGraphPhotoFetch();

    const { auth, database } = await createHostedAuth();
    const email = "linked-work-customer@keeper.sh";
    await seedVerifiedCustomer({
      database,
      email,
      linkedMicrosoftSubject: "linked-subject",
      userId: "linked-work-customer",
    });

    const result = await signInWithMicrosoft(auth, {
      email,
      name: "Linked Work Account",
      oid: "entra-object-id",
      sub: "linked-subject",
      tid: "contoso-tenant",
    });

    expect(result.error).toBeNull();
    expect(result.data?.user.id).toBe("linked-work-customer");
    expect(await readEmailVerified(database, "linked-work-customer")).toBe(true);
  });
});
