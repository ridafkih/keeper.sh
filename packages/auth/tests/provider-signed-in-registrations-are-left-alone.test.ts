import { PGlite } from "@electric-sql/pglite";
import {
  account as accountTable,
  user as userTable,
  verification as verificationTable,
} from "@keeper.sh/database/auth-schema";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/index";

const BASE_URL = "http://localhost:3000";
const SECRET = "test-secret-for-provider-asserted-email-not-reclaimable";
const OTHER_PASSWORD = "another-chosen-password";
const CUSTOMER_PASSWORD = "customer-original-password";

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
    deleteUserResidueRecorder: async () => {},
    deleteUserTeardown: async () => {},
    deleteUserTeardownRollback: async () => {},
    baseUrl: BASE_URL,
    commercialMode: true,
    database: database as unknown as BunSQLDatabase,
    googleClientId: "test-google-client-id",
    googleClientSecret: "test-google-client-secret",
    microsoftClientId: "test-microsoft-client-id",
    microsoftClientSecret: "test-microsoft-client-secret",
    secret: SECRET,
  });

  return { auth, database };
};

const resolveSocialProvider = async (
  auth: Awaited<ReturnType<typeof createHostedAuth>>["auth"],
  providerId: string,
) => {
  const context = await auth.$context;
  const provider = context.socialProviders.find(
    (candidate) => candidate.id === providerId,
  );

  if (!provider) {
    throw new TypeError(`Social provider ${providerId} is not configured`);
  }

  return provider;
};

const mapSocialProfile = async (
  auth: Awaited<ReturnType<typeof createHostedAuth>>["auth"],
  providerId: string,
  claims: Record<string, unknown>,
) => {
  const provider = await resolveSocialProvider(auth, providerId);
  const profile = await provider.getUserInfo({
    accessToken: "test-access-token",
    idToken: buildIdToken(claims),
  } as never);

  if (!profile) {
    throw new TypeError(`Social provider ${providerId} returned no profile`);
  }

  return profile.user;
};

interface SeedSocialCustomerParams {
  createdAt: Date;
  database: Awaited<ReturnType<typeof createHostedAuth>>["database"];
  email: string;
  emailVerified: boolean;
  name: string;
  providerId: string;
  userId: string;
}

const seedSocialCustomer = async ({
  createdAt,
  database,
  email,
  emailVerified,
  name,
  providerId,
  userId,
}: SeedSocialCustomerParams) => {
  await database.insert(userTable).values({
    createdAt,
    email,
    emailVerified,
    id: userId,
    name,
    updatedAt: createdAt,
  });

  await database.insert(accountTable).values({
    accountId: `${providerId}-subject-${userId}`,
    createdAt,
    id: `${providerId}-account-${userId}`,
    providerId,
    updatedAt: createdAt,
    userId,
  });

  await database.insert(accountTable).values({
    accountId: userId,
    createdAt,
    id: `credential-account-${userId}`,
    password: await hashPassword(CUSTOMER_PASSWORD),
    providerId: "credential",
    updatedAt: createdAt,
    userId,
  });
};

const attemptSignUpAs = (
  auth: Awaited<ReturnType<typeof createHostedAuth>>["auth"],
  email: string,
) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email,
        name: "Second Signup",
        password: OTHER_PASSWORD,
      }),
      headers: { "content-type": "application/json", origin: BASE_URL },
      method: "POST",
    }),
  );

const readPendingReclaims = (
  database: Awaited<ReturnType<typeof createHostedAuth>>["database"],
  email: string,
) =>
  database
    .select()
    .from(verificationTable)
    .where(
      eq(verificationTable.identifier, `unverified-registration-reclaim:${email}`),
    );

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

describe("a registration created through a provider", () => {
  it("is left alone when someone signs up with the same Microsoft address", async () => {
    stubGraphPhotoFetch();

    const { auth, database } = await createHostedAuth();
    const email = "outlook-customer@keeper.sh";
    const mapped = await mapSocialProfile(auth, "microsoft", {
      email,
      name: "Established Outlook Customer",
      oid: "entra-object-id",
      sub: "entra-subject",
      tid: "contoso-tenant",
    });

    expect(mapped.email).toBe(email);

    await seedSocialCustomer({
      createdAt: new Date(),
      database,
      email,
      emailVerified: mapped.emailVerified === true,
      name: "Established Outlook Customer",
      providerId: "microsoft",
      userId: "established-outlook-customer",
    });

    const response = await attemptSignUpAs(auth, email);
    expect(response.status).toBe(200);

    expect(await readPendingReclaims(database, email)).toEqual([]);

    const rows = await database
      .select()
      .from(userTable)
      .where(eq(userTable.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Established Outlook Customer");
  });

  it("is left alone when someone signs up with the same Google address", async () => {
    stubGraphPhotoFetch();

    const { auth, database } = await createHostedAuth();
    const email = "google-customer@keeper.sh";
    const mapped = await mapSocialProfile(auth, "google", {
      email,
      email_verified: true,
      name: "Established Google Customer",
      sub: "google-subject",
    });

    expect(mapped.email).toBe(email);

    await seedSocialCustomer({
      createdAt: new Date(),
      database,
      email,
      emailVerified: mapped.emailVerified === true,
      name: "Established Google Customer",
      providerId: "google",
      userId: "established-google-customer",
    });

    const response = await attemptSignUpAs(auth, email);
    expect(response.status).toBe(200);

    expect(await readPendingReclaims(database, email)).toEqual([]);
  });

  it("is left alone for rows written before this change", async () => {
    const { auth, database } = await createHostedAuth();
    const email = "legacy-outlook-customer@keeper.sh";

    await seedSocialCustomer({
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      database,
      email,
      emailVerified: false,
      name: "Legacy Outlook Customer",
      providerId: "microsoft",
      userId: "legacy-outlook-customer",
    });

    const response = await attemptSignUpAs(auth, email);
    expect(response.status).toBe(200);

    expect(await readPendingReclaims(database, email)).toEqual([]);
  });
});
