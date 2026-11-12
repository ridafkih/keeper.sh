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

interface CreateTestAuthOptions {
  commercialMode?: boolean;
  disableLocalAuth?: boolean;
  oidc?: boolean;
  trustEmailVerified?: boolean;
}

const createTestAuth = async ({
  commercialMode = false,
  disableLocalAuth = false,
  oidc = true,
  trustEmailVerified = false,
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
      oidcTrustEmailVerified: trustEmailVerified,
    }),
  });

  return { auth, capabilities, database };
};

type TestAuth = Awaited<ReturnType<typeof createTestAuth>>;

interface OidcTestProfile {
  email: string;
  email_verified?: unknown;
  name?: string;
  sub: string;
}

const readConfiguredOidcProfileMapper = (auth: TestAuth["auth"]) => {
  const plugin = auth.options.plugins.find((candidate) => candidate.id === "generic-oauth");
  const [config] = plugin?.options?.config ?? [];
  if (!config?.mapProfileToUser) {
    throw new Error("The OIDC provider is not configured");
  }
  return config.mapProfileToUser as (profile: OidcTestProfile) => Record<string, unknown>;
};

const signInWithOidc = async (auth: TestAuth["auth"], profile: OidcTestProfile) => {
  const context = await auth.$context;
  const mapProfileToUser = readConfiguredOidcProfileMapper(auth);
  const userInfo = {
    email: profile.email,
    id: profile.sub,
    name: profile.name ?? "",
    ...mapProfileToUser(profile),
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
  { email, emailVerified = true, id }: { email: string; emailVerified?: boolean; id: string },
) => {
  await database.insert(userTable).values({
    email,
    emailVerified,
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

const UNTRUSTED = { trustEmailVerified: false };
const TRUSTED = { trustEmailVerified: true };

describe("an OIDC profile", () => {
  it("never marks the email as verified unless the provider's claim is trusted", () => {
    expect(
      mapOidcProfileToUser(
        { email: "person@example.com", email_verified: true, name: "Person" },
        UNTRUSTED,
      ),
    ).toEqual({ emailVerified: false, name: "Person" });
  });

  it("marks the email as verified when the trusted provider asserts it", () => {
    expect(
      mapOidcProfileToUser(
        { email: "person@example.com", email_verified: true, name: "Person" },
        TRUSTED,
      ),
    ).toEqual({ emailVerified: true, name: "Person" });
  });

  it.each([
    { claim: false, label: "false" },
    { claim: "true", label: "the string true" },
    { claim: 1, label: "1" },
  ])("keeps the email unverified when the trusted provider's claim is $label", ({ claim }) => {
    expect(
      mapOidcProfileToUser({ email: "person@example.com", email_verified: claim }, TRUSTED)
        .emailVerified,
    ).toBe(false);
  });

  it("keeps the email unverified when the trusted provider sends no claim", () => {
    expect(mapOidcProfileToUser({ email: "person@example.com" }, TRUSTED).emailVerified).toBe(
      false,
    );
  });

  it("never trusts a claim for a local account address", () => {
    expect(
      mapOidcProfileToUser({ email: "admin@local", email_verified: true }, TRUSTED).emailVerified,
    ).toBe(false);
  });

  it("falls back to preferred_username when the provider sends no name", () => {
    expect(
      mapOidcProfileToUser(
        { email: "person@example.com", preferred_username: "person" },
        UNTRUSTED,
      ).name,
    ).toBe("person");
  });

  it("falls back to the email's local part when there is no name or preferred_username", () => {
    expect(
      mapOidcProfileToUser({ email: "person@example.com", name: "  " }, UNTRUSTED).name,
    ).toBe("person");
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

describe("an OIDC sign-in with OIDC_TRUST_EMAIL_VERIFIED", () => {
  it("links to an existing verified account when the provider verified the email", async () => {
    const { auth, database } = await createTestAuth({ trustEmailVerified: true });
    await seedUser(database, { email: "existing@example.com", id: "existing-user" });

    const result = await signInWithOidc(auth, {
      email: "existing@example.com",
      email_verified: true,
      sub: "existing-subject",
    });

    expect(result.error).toBeNull();
    expect(result.data?.user.id).toBe("existing-user");
    expect(await readAccountProviders(database, "existing-user")).toEqual(["oidc"]);
  });

  it.each([
    { label: "false", profile: { email_verified: false } },
    { label: "missing", profile: {} },
  ])("does not link when the provider's email_verified is $label", async ({ profile }) => {
    const { auth, database } = await createTestAuth({ trustEmailVerified: true });
    await seedUser(database, { email: "existing@example.com", id: "existing-user" });

    const result = await signInWithOidc(auth, {
      email: "existing@example.com",
      sub: "existing-subject",
      ...profile,
    });

    expect(result.error).toBe("account not linked");
    expect(await readAccountProviders(database, "existing-user")).toEqual([]);
  });

  it("does not link to an existing account whose own email is unverified", async () => {
    const { auth, database } = await createTestAuth({ trustEmailVerified: true });
    await seedUser(database, {
      email: "unverified@example.com",
      emailVerified: false,
      id: "unverified-user",
    });

    const result = await signInWithOidc(auth, {
      email: "unverified@example.com",
      email_verified: true,
      sub: "claiming-subject",
    });

    expect(result.error).toBe("account not linked");
    expect(await readAccountProviders(database, "unverified-user")).toEqual([]);
    const [user] = await database
      .select({ emailVerified: userTable.emailVerified })
      .from(userTable)
      .where(eq(userTable.id, "unverified-user"));
    expect(user?.emailVerified).toBe(false);
  });

  it("does not link to a local username account through its @local address", async () => {
    const { auth, database } = await createTestAuth({ trustEmailVerified: true });
    await seedUser(database, { email: "admin@local", id: "local-admin" });

    const result = await signInWithOidc(auth, {
      email: "admin@local",
      email_verified: true,
      sub: "impersonating-subject",
    });

    expect(result.error).toBe("account not linked");
    expect(await readAccountProviders(database, "local-admin")).toEqual([]);
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
