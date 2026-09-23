import { PGlite } from "@electric-sql/pglite";
import { account as accountTable, user as userTable } from "@keeper.sh/database/auth-schema";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/index";
import { mapOidcProfileToUser, resolveOidcDiscoveryUrl } from "../src/oidc";

const BASE_URL = "http://localhost:3000";
const SECRET = "test-secret-for-oidc-sign-in";

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

interface CreateTestAuthOptions {
  commercialMode?: boolean;
  disableLocalAuth?: boolean;
  oidc?: boolean;
}

const createTestAuth = async ({
  commercialMode = false,
  disableLocalAuth = false,
  oidc = true,
}: CreateTestAuthOptions = {}) => {
  const client = new PGlite();
  await client.exec(AUTH_DDL);

  const database = drizzle(client);
  const { auth, capabilities } = createAuth({
    baseUrl: BASE_URL,
    commercialMode,
    database: database as unknown as BunSQLDatabase,
    disableLocalAuth,
    secret: SECRET,
    ...(oidc && {
      oidcClientId: "oidc-client-id",
      oidcClientSecret: "oidc-client-secret",
      oidcIssuerUrl: "https://id.example.com",
    }),
  });

  return { auth, capabilities, database };
};

type TestAuth = Awaited<ReturnType<typeof createTestAuth>>;

const signInWithOidc = async (
  auth: TestAuth["auth"],
  profile: { email: string; email_verified?: boolean; name?: string; sub: string },
) => {
  const context = await auth.$context;
  const userInfo = {
    email: profile.email,
    id: profile.sub,
    name: profile.name ?? "",
    ...mapOidcProfileToUser(profile),
  };

  return handleOAuthUserInfo({ context } as never, {
    account: {
      accessToken: "test-access-token",
      accountId: profile.sub,
      providerId: "oidc",
    },
    userInfo,
  } as never);
};

const seedUser = async (
  database: TestAuth["database"],
  { email, id }: { email: string; id: string },
) => {
  await database.insert(userTable).values({
    email,
    emailVerified: true,
    id,
    name: "Existing User",
  });
};

const readAccountProviders = async (database: TestAuth["database"], userId: string) => {
  const rows = await database
    .select({ providerId: accountTable.providerId })
    .from(accountTable)
    .where(eq(accountTable.userId, userId));
  return rows.map((row) => row.providerId);
};

const postJson = (auth: TestAuth["auth"], path: string, body: object) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", origin: BASE_URL },
      method: "POST",
    }),
  );

describe("the OIDC discovery URL", () => {
  it("keeps the issuer's path for realm-scoped providers", () => {
    expect(resolveOidcDiscoveryUrl("https://auth.example.com/realms/keeper")).toBe(
      "https://auth.example.com/realms/keeper/.well-known/openid-configuration",
    );
  });

  it("handles an issuer published with a trailing slash", () => {
    expect(
      resolveOidcDiscoveryUrl("https://authentik.example.com/application/o/keeper/"),
    ).toBe(
      "https://authentik.example.com/application/o/keeper/.well-known/openid-configuration",
    );
  });

  it("handles an issuer at the origin root", () => {
    expect(resolveOidcDiscoveryUrl("https://id.example.com")).toBe(
      "https://id.example.com/.well-known/openid-configuration",
    );
  });
});

describe("an OIDC profile", () => {
  it("never marks the email as verified, whatever the provider claims", () => {
    expect(
      mapOidcProfileToUser({ email: "person@example.com", email_verified: true, name: "Person" }),
    ).toEqual({ emailVerified: false, name: "Person" });
  });

  it("falls back to preferred_username when the provider sends no name", () => {
    expect(
      mapOidcProfileToUser({ email: "person@example.com", preferred_username: "person" }).name,
    ).toBe("person");
  });

  it("falls back to the email's local part when there is no name or preferred_username", () => {
    expect(mapOidcProfileToUser({ email: "person@example.com", name: "  " }).name).toBe("person");
  });
});

describe("an OIDC sign-in", () => {
  it("creates a new account for an address nobody has registered", async () => {
    const { auth, database } = await createTestAuth();

    const result = await signInWithOidc(auth, {
      email: "new-person@example.com",
      email_verified: true,
      name: "New Person",
      sub: "new-person-subject",
    });

    expect(result.error).toBeNull();
    const [created] = await database
      .select()
      .from(userTable)
      .where(eq(userTable.email, "new-person@example.com"));
    expect(created?.name).toBe("New Person");
    expect(created?.username).toBeNull();
  });

  it("is not merged into an existing account with the same email", async () => {
    const { auth, database } = await createTestAuth();
    await seedUser(database, { email: "existing@example.com", id: "existing-user" });

    const result = await signInWithOidc(auth, {
      email: "existing@example.com",
      email_verified: true,
      sub: "existing-subject",
    });

    expect(result.error).toBe("account not linked");
    expect(await readAccountProviders(database, "existing-user")).toEqual([]);
  });

  it("is not merged into a local username account through its @local address", async () => {
    const { auth, database } = await createTestAuth();
    await seedUser(database, { email: "admin@local", id: "local-admin" });

    const result = await signInWithOidc(auth, {
      email: "admin@local",
      email_verified: true,
      sub: "impersonating-subject",
    });

    expect(result.error).toBe("account not linked");
    expect(await readAccountProviders(database, "local-admin")).toEqual([]);
  });

  it("cannot claim an @local address before a local account takes it", async () => {
    const { auth, database } = await createTestAuth();

    const result = await signInWithOidc(auth, {
      email: "future-admin@local",
      email_verified: true,
      sub: "squatting-subject",
    });

    expect(result.error).not.toBeNull();
    expect(
      await database.select().from(userTable).where(eq(userTable.email, "future-admin@local")),
    ).toEqual([]);
  });
});

describe("DISABLE_LOCAL_AUTH", () => {
  it("rejects username sign-up and sign-in on the server", async () => {
    const { auth } = await createTestAuth({ disableLocalAuth: true });

    const signUp = await postJson(auth, "/username-only/sign-up", {
      password: "a-long-enough-password",
      username: "someone",
    });
    expect(signUp.status).toBe(403);

    const signIn = await postJson(auth, "/username-only/sign-in", {
      password: "a-long-enough-password",
      username: "someone",
    });
    expect(signIn.status).toBe(403);
  });

  it("leaves username sign-up alone when OIDC isn't configured", async () => {
    const { auth, capabilities } = await createTestAuth({ disableLocalAuth: true, oidc: false });

    expect("disableLocalAuth" in capabilities).toBe(false);

    const signUp = await postJson(auth, "/username-only/sign-up", {
      password: "a-long-enough-password",
      username: "someone",
    });
    expect(signUp.status).toBe(200);
  });
});

describe("hosted email sign-up", () => {
  it("does not require a username", async () => {
    const { auth } = await createTestAuth({ commercialMode: true, oidc: false });

    const response = await postJson(auth, "/sign-up/email", {
      email: "hosted-customer@example.com",
      name: "Hosted Customer",
      password: "a-long-enough-password",
    });

    expect(response.status).toBe(200);
  });
});
